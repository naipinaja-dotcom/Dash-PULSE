import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { usePostHog } from "@posthog/react";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/admin-layout";
import { parseCSV } from "@/lib/csv";
import { resolveOrCreateRiders } from "@/lib/rider-lookup";
import { classifyAllClients } from "@/lib/delivery-classification";
import { cleanDuplicateDeliveries } from "@/lib/delivery-dedup";
import { reverseGeocodeDistricts } from "@/lib/api/geocoding.functions";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { confirmDialog } from "@/components/confirm-dialog";
import { Upload, FileText, Loader2, AlertTriangle, X, RefreshCw, Trash2 } from "lucide-react";
import { ClientCombobox } from "@/components/client-combobox";

export const Route = createFileRoute("/admin/upload")({ component: UploadPage });

type Client = { id: string; name: string };

// buat query .in() dgn ribuan ID tanpa nabrak batas panjang URL
async function inChunks<T>(
  table: string,
  column: string,
  values: string[],
  select: string,
): Promise<T[]> {
  const uniq = Array.from(new Set(values.filter(Boolean)));
  const out: T[] = [];
  for (let i = 0; i < uniq.length; i += 200) {
    const { data } = await (supabase as any)
      .from(table)
      .select(select)
      .in(column, uniq.slice(i, i + 200));
    out.push(...((data ?? []) as T[]));
  }
  return out;
}

function UploadPage() {
  const [tab, setTab] = useState<"delivery" | "attendance">("delivery");
  return (
    <AdminLayout title="Upload Data" subtitle="Import CSV delivery dan attendance">
      <div className="flex gap-1 p-1 bg-muted rounded-md w-fit mb-5">
        {(["delivery", "attendance"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 text-sm rounded ${tab === t ? "bg-card shadow-sm font-medium" : "text-muted-foreground"}`}
          >
            {t === "delivery" ? "Upload Delivery" : "Upload Attendance"}
          </button>
        ))}
      </div>
      {tab === "delivery" ? <DeliveryUpload /> : <AttendanceUpload />}
    </AdminLayout>
  );
}

const DELIVERY_FIELDS = [
  "driver_code",
  "driver_name",
  "client_name",
  "status",
  "dash_delivery_id",
  "provider_order_id",
  "delivery_date",
  "awb",
  "district",
  "distance_km",
  "weight_kg",
  "destination_address",
  "sender_name",
  "receiver_name",
  "service_type",
  "destination_lat",
  "destination_lng",
];

interface DeliveryPreview {
  records: Record<string, unknown>[]; // baru + yang mau ditimpa, siap insert
  totalRows: number;
  newCount: number; // belum ada di DB
  overwriteCount: number; // udah ada di DB → ditimpa (data lama dihapus, diganti yg baru)
  overwriteDashIds: string[]; // dash id lama yang dihapus dulu sebelum insert
  overwriteSamples: { dash: string; provider: string }[];
  fileRepeatCount: number; // baris yang persis dobel DI DALAM file itu sendiri → di-skip
  droppedStatusCount: number; // status selain COMPLETED/FAILED (mis. PENDING_PICKUP) → dibuang, gak diupload
  anomalyCount: number;
  anomalySamples: { dash: string; provider: string }[];
  unmatchedClients: string[];
  createdRiderCodes: string[];
}

function DeliveryUpload() {
  const posthog = usePostHog();
  const { session } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [preview, setPreview] = useState<DeliveryPreview | null>(null);
  const [reclassifying, setReclassifying] = useState(false);
  const [cleaning, setCleaning] = useState(false);

  useEffect(() => {
    supabase
      .from("clients")
      .select("id, name")
      .then(({ data }) => setClients(data ?? []));
  }, []);

  // Buat data lama yang udah keupload SEBELUM fitur klasifikasi Delivery/Return
  // ini ada — hitung ulang semua client, bukan cuma yang baru diupload.
  const reclassifyAll = async () => {
    if (
      !(await confirmDialog({
        title: "Hitung ulang Delivery/Return?",
        description: `Untuk semua ${clients.length} client. Ini bisa makan waktu kalau datanya banyak.`,
        confirmText: "Hitung ulang",
        danger: false,
      }))
    )
      return;
    setReclassifying(true);
    try {
      const results = await classifyAllClients(clients.map((c) => c.id));
      const totalUnclassified = results.reduce((s, r) => s + r.unclassifiedCount, 0);
      toast.success(`Klasifikasi ulang selesai buat ${results.length} client.`);
      if (totalUnclassified > 0)
        toast.warning(
          `${totalUnclassified} baris ga bisa ditandain (kemungkinan outlet-ke-outlet) — cek data Sender/Receiver Name.`,
        );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setReclassifying(false);
    }
  };

  // Bersihin data yang terlanjur dobel di DB (dari upload-upload lama sebelum
  // fitur timpa ada). Sisain 1 per order (yang terbaru), buang salinannya.
  const cleanDupes = async () => {
    if (
      !(await confirmDialog({
        title: "Bersihkan data duplikat?",
        description:
          "Sistem nyisir semua data pengiriman, cari yang Dash ID + Provider ID kembar, lalu hapus salinannya (sisain 1 yang paling baru). Data yang tidak dobel aman.",
        confirmText: "Bersihkan",
        danger: false,
      }))
    )
      return;
    setCleaning(true);
    try {
      const r = await cleanDuplicateDeliveries();
      if (r.deleted === 0)
        toast.success(`Bersih — ga ada duplikat dari ${r.scanned.toLocaleString("id-ID")} baris.`);
      else
        toast.success(
          `${r.deleted.toLocaleString("id-ID")} baris dobel dihapus (dari ${r.duplicateGroups} order). Total dicek: ${r.scanned.toLocaleString("id-ID")}.`,
        );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCleaning(false);
    }
  };

  const onFile = async (f: File) => {
    setFile(f);
    const text = await f.text();
    const parsed = parseCSV(text);
    if (!parsed.length) return toast.error("CSV kosong");
    setHeaders(parsed[0]);
    setRows(parsed.slice(1));
    const m: Record<string, string> = {};
    DELIVERY_FIELDS.forEach((field) => {
      let found = parsed[0].find(
        (h) => h.toLowerCase().replace(/[^a-z]/g, "") === field.replace(/_/g, ""),
      );
      // Fallback buat nama kolom yang lebih verbose di data mentah operasional
      // (mis. "Total Distance In KM" alih-alih "distance_km").
      if (!found) {
        if (field === "client_name") found = parsed[0].find((h) => /provider|client/i.test(h));
        else if (field === "distance_km") found = parsed[0].find((h) => /distance/i.test(h));
        else if (field === "weight_kg") found = parsed[0].find((h) => /weight/i.test(h));
        else if (field === "destination_address")
          found = parsed[0].find(
            (h) => /destination/i.test(h) && !/lat|long|coordinate|koordinat/i.test(h),
          );
        // Lat/Long bisa 2 kolom terpisah, ATAU 1 kolom gabungan "lat, lng"
        // dalam satu sel (mis. "Destination Coordinate": "-6.17942, 106.710177").
        // Kalau gak ada kolom terpisah, dua-duanya di-map ke kolom gabungan yang
        // sama — nanti dipecah pas baca baris (lihat parseCombinedCoord di analyze()).
        // Data mentah sering punya DUA kolom koordinat ("Origin Coordinate" +
        // "Destination Coordinate") — prioritaskan yang jelas nyebut
        // destination/tujuan dulu, baru fallback ke "coordinate" polos kalau
        // cuma ada 1 kolom koordinat (gak ambigu).
        else if (field === "destination_lat")
          found =
            parsed[0].find((h) => /^lat|latitude/i.test(h)) ??
            parsed[0].find((h) => /(destination|tujuan).*(coordinate|koordinat)/i.test(h)) ??
            parsed[0].find((h) => /coordinate|koordinat/i.test(h));
        else if (field === "destination_lng")
          found =
            parsed[0].find((h) => /^lon|^lng|longitude/i.test(h)) ??
            parsed[0].find((h) => /(destination|tujuan).*(coordinate|koordinat)/i.test(h)) ??
            parsed[0].find((h) => /coordinate|koordinat/i.test(h));
        // Tanggal patokan fee = tanggal barang DIKIRIM. Nama kolomnya beda-beda di data mentah.
        else if (field === "delivery_date")
          found =
            parsed[0].find((h) => /tanggal\s*delivery|tgl\s*kirim|tanggal\s*kirim/i.test(h)) ??
            parsed[0].find((h) => /tanggal\s*pickup/i.test(h)) ??
            parsed[0].find((h) => /tanggal\s*status/i.test(h));
      }
      if (found) m[field] = found;
    });
    setMapping(m);
  };

  const hasClientColumn = !!mapping["client_name"];
  const hasDedupKeys = !!mapping["dash_delivery_id"] && !!mapping["provider_order_id"];

  // Tahap 1: baca file, cocokkan rider/client, cek duplikat — TAMPILIN dulu
  // hasilnya sebelum beneran nulis ke database.
  const analyze = async () => {
    if (!clientId && !hasClientColumn)
      return toast.error("Pilih client, atau map kolom client di file");
    if (!file || rows.length === 0) return toast.error("Upload CSV dulu");
    setAnalyzing(true);

    const get = (r: string[], f: string) => {
      const idx = headers.indexOf(mapping[f]);
      return idx >= 0 ? r[idx] : null;
    };

    // Tanggal patokan fee (delivery_date): pakai kolom yang di-map; kalau baris
    // itu kosong (mis. order belum dikirim), mundur ke pickup → status → pembuatan.
    // Ambil BAGIAN TANGGAL-nya aja (buang jam). Kalau ga ada sama sekali → hari ini.
    const dateColIdx = (re: RegExp) => headers.findIndex((h) => re.test(h));
    const idxMapped = mapping["delivery_date"] ? headers.indexOf(mapping["delivery_date"]) : -1;
    const idxPickup = dateColIdx(/tanggal\s*pickup/i);
    const idxStatus = dateColIdx(/tanggal\s*status/i);
    const idxCreate = dateColIdx(/tanggal\s*(pembuatan|order|buat)/i);
    // Buang nilai bukan-tanggal (mis. "-", kosong) — biar ga bikin insert gagal
    // (delivery_date bertipe date NOT NULL). Kalau format ISO, ambil bagian
    // tanggalnya; format lain dibiarin utuh biar Postgres yang parse.
    const cleanDate = (v: string | null | undefined): string | null => {
      const t = (v ?? "").trim();
      if (!t || !/\d/.test(t)) return null; // "-", kosong, atau ga ada angka → lewati
      return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : t;
    };
    const pickDeliveryDate = (r: string[]) => {
      for (const idx of [idxMapped, idxPickup, idxStatus, idxCreate]) {
        const c = idx >= 0 ? cleanDate(r[idx]) : null;
        if (c) return c;
      }
      return new Date().toISOString().slice(0, 10);
    };

    const codes = rows.map((r) => get(r, "driver_code"));
    const namesByCode: Record<string, string> = {};
    rows.forEach((r) => {
      const code = get(r, "driver_code");
      const name = get(r, "driver_name");
      if (code && name) namesByCode[code] = name;
    });
    let riderMap: Map<string, string>;
    let createdCodes: string[];
    try {
      ({ map: riderMap, createdCodes } = await resolveOrCreateRiders(codes, namesByCode));
    } catch (e) {
      setAnalyzing(false);
      return toast.error(`Gagal lookup rider: ${(e as Error).message}`);
    }

    // Client TIDAK di-auto-create (beda kebijakan sama rider) — nama yang ga
    // ketemu di daftar client yang ADA cuma diflag, bukan ditebak/dibikinin,
    // karena salah tulis dikit bisa bikin "client hantu" & fee nyasar.
    const clientByName = new Map(clients.map((c) => [c.name.trim().toLowerCase(), c.id]));
    const unmatchedClients = new Set<string>();
    const resolveClientId = (rawName: string | null): string | null => {
      if (rawName && rawName.trim()) {
        const hit = clientByName.get(rawName.trim().toLowerCase());
        if (hit) return hit;
        unmatchedClients.add(rawName.trim());
        return null; // JANGAN fallback ke dropdown — beda client, jangan ditebak salah
      }
      return clientId || null; // baris tanpa nilai client -> pakai default dropdown
    };

    // Kolom lat/lng gabungan ("lat, lng" dalam 1 sel) ke-map ke header yang
    // SAMA buat destination_lat & destination_lng (lihat onFile) — split di
    // sini kalau kedetect begitu, dari kolom terpisah kalau nggak.
    const isCombinedCoord = !!mapping["destination_lat"] && mapping["destination_lat"] === mapping["destination_lng"];
    const parseCombinedCoord = (v: string | null): [number, number] | null => {
      if (!v) return null;
      const parts = v
        .split(/[,;]\s*|\s+/)
        .map((s) => parseFloat(s))
        .filter((n) => !isNaN(n));
      return parts.length >= 2 ? [parts[0], parts[1]] : null;
    };

    const recordsRaw = rows.map((r) => {
      const driverCode = get(r, "driver_code");
      const combinedCoord = isCombinedCoord ? parseCombinedCoord(get(r, "destination_lat")) : null;
      return {
        client_id: hasClientColumn ? resolveClientId(get(r, "client_name")) : clientId || null,
        rider_id: driverCode ? (riderMap.get(driverCode) ?? null) : null,
        driver_code: driverCode,
        status: get(r, "status"),
        dash_delivery_id: get(r, "dash_delivery_id"),
        provider_order_id: get(r, "provider_order_id"),
        delivery_date: pickDeliveryDate(r),
        awb: get(r, "awb"),
        district: get(r, "district"),
        distance_km: parseFloat(get(r, "distance_km") || "0") || null,
        weight_kg: parseFloat(get(r, "weight_kg") || "0") || null,
        destination_address: get(r, "destination_address"),
        sender_name: get(r, "sender_name"),
        receiver_name: get(r, "receiver_name"),
        service_type: get(r, "service_type"),
        destination_lat: combinedCoord
          ? combinedCoord[0]
          : (() => {
              const v = get(r, "destination_lat");
              return v ? parseFloat(v) : null;
            })(),
        destination_lng: combinedCoord
          ? combinedCoord[1]
          : (() => {
              const v = get(r, "destination_lng");
              return v ? parseFloat(v) : null;
            })(),
      };
    });

    // Cuma COMPLETED & FAILED yang berguna buat payroll/analytics — status
    // transien kayak PENDING_PICKUP cuma numpuk noise di Shipment Analytics
    // tanpa pernah kepake di mana pun (calcScheme dkk cuma baca "completed").
    // Dibuang di sini (gak pernah masuk delivery_records) daripada disimpan
    // terus dihapus belakangan.
    const ALLOWED_STATUSES = new Set(["COMPLETED", "FAILED"]);
    const records = recordsRaw.filter((r) =>
      ALLOWED_STATUSES.has(
        String(r.status ?? "")
          .trim()
          .toUpperCase(),
      ),
    );
    const droppedStatusCount = recordsRaw.length - records.length;

    // Auto-isi district yang kosong dari koordinat (reverse geocoding ORS) —
    // CSV operasional sering ada Lat/Long tapi kolom district-nya kosong/gak
    // ada sama sekali. Kalau session admin habis atau ORS error, di-skip
    // (bukan gagalin seluruh upload) — district tetap bisa diisi manual.
    //
    // Beberapa sistem operasional export kolom "District" isinya alamat
    // lengkap (duplikat dari destination_address), bukan nama district
    // singkat kayak yang dipakai override per-area di Pricing Scheme
    // ("Jakarta Pusat", dll — semua <40 karakter). Nilai district sepanjang
    // itu gak berguna buat matching pricing, jadi tetap dianggap "kosong"
    // dan ditimpa hasil geocode kalau koordinatnya ada.
    // ponytail: ambang 40 karakter, naikkan kalau ada nama district legit yang lebih panjang.
    const looksLikeFullAddress = (d: string | null) => !d || d.trim().length > 40;
    const needsGeocode = records.filter(
      (r) => looksLikeFullAddress(r.district) && r.destination_lat != null && r.destination_lng != null,
    );
    if (needsGeocode.length > 0) {
      if (!session?.access_token) {
        toast.warning("Sesi admin habis — district dari koordinat dilewati, isi manual kalau perlu.");
      } else {
        try {
          const { districts } = await reverseGeocodeDistricts({
            data: {
              adminToken: session.access_token,
              points: needsGeocode.map((r) => ({
                lat: r.destination_lat as number,
                lng: r.destination_lng as number,
              })),
            },
          });
          needsGeocode.forEach((r, i) => {
            if (districts[i]) r.district = districts[i];
          });
        } catch (e) {
          toast.warning(`Gagal isi district dari koordinat: ${(e as Error).message}`);
        }
      }
    }

    // Deteksi duplikat: kunci = dash_delivery_id DAN provider_order_id
    // dua-duanya harus sama baru dianggap duplikat. Kalau cuma salah satu
    // yang sama -> anomali, tetap diupload tapi diflag (jangan auto-skip).
    let anomalySamples: DeliveryPreview["anomalySamples"] = [];
    let finalRecords = records;
    let overwriteDashIds: string[] = [];
    let overwriteSamples: DeliveryPreview["overwriteSamples"] = [];
    let fileRepeatCount = 0;

    if (hasDedupKeys) {
      const dashIds = records.map((r) => r.dash_delivery_id).filter((v): v is string => !!v);
      const providerIds = records.map((r) => r.provider_order_id).filter((v): v is string => !!v);
      const [byDash, byProvider] = await Promise.all([
        inChunks<{ dash_delivery_id: string; provider_order_id: string }>(
          "delivery_records",
          "dash_delivery_id",
          dashIds,
          "dash_delivery_id, provider_order_id",
        ),
        inChunks<{ dash_delivery_id: string; provider_order_id: string }>(
          "delivery_records",
          "provider_order_id",
          providerIds,
          "dash_delivery_id, provider_order_id",
        ),
      ]);
      const dbByDash = new Map<string, Set<string>>();
      const dbByProvider = new Map<string, Set<string>>();
      [...byDash, ...byProvider].forEach((e) => {
        if (e.dash_delivery_id)
          (
            dbByDash.get(e.dash_delivery_id) ??
            dbByDash.set(e.dash_delivery_id, new Set()).get(e.dash_delivery_id)!
          ).add(e.provider_order_id);
        if (e.provider_order_id)
          (
            dbByProvider.get(e.provider_order_id) ??
            dbByProvider.set(e.provider_order_id, new Set()).get(e.provider_order_id)!
          ).add(e.dash_delivery_id);
      });

      const seenInFile = new Map<string, number>(); // key -> index kemunculan pertama
      const isFileRepeat: boolean[] = new Array(records.length).fill(false); // dobel PERSIS di dalam file → skip
      const isDbDup: boolean[] = new Array(records.length).fill(false); // udah ada di DB → ditimpa
      const anomalies: DeliveryPreview["anomalySamples"] = [];

      records.forEach((rec, i) => {
        const dash = rec.dash_delivery_id as string | null;
        const provider = rec.provider_order_id as string | null;
        if (!dash || !provider) return; // ga bisa dicek tanpa dua-duanya → dianggap baru
        const key = dash + "|" + provider;
        if (seenInFile.has(key)) {
          isFileRepeat[i] = true; // baris kembar di file yang sama, ga usah di-insert 2×
          return;
        }
        seenInFile.set(key, i);
        if (dbByDash.get(dash)?.has(provider)) {
          isDbDup[i] = true; // udah ada di DB → nanti data lama dihapus, diganti yang ini (TIMPA)
        } else if (dbByDash.has(dash) || dbByProvider.has(provider)) {
          anomalies.push({ dash, provider });
        }
      });

      finalRecords = records.filter((_, i) => !isFileRepeat[i]); // baru + yang ditimpa
      overwriteDashIds = records
        .filter((_, i) => isDbDup[i])
        .map((r) => r.dash_delivery_id as string);
      overwriteSamples = records
        .filter((_, i) => isDbDup[i])
        .slice(0, 50)
        .map((r) => ({
          dash: r.dash_delivery_id as string,
          provider: r.provider_order_id as string,
        }));
      fileRepeatCount = isFileRepeat.filter(Boolean).length;
      anomalySamples = anomalies;
    }

    setAnalyzing(false);
    setPreview({
      records: finalRecords,
      totalRows: recordsRaw.length,
      newCount: finalRecords.length - overwriteDashIds.length,
      overwriteCount: overwriteDashIds.length,
      overwriteDashIds,
      overwriteSamples,
      fileRepeatCount,
      droppedStatusCount,
      anomalyCount: anomalySamples.length,
      anomalySamples: anomalySamples.slice(0, 50),
      unmatchedClients: Array.from(unmatchedClients),
      createdRiderCodes: createdCodes,
    });
  };

  // Tahap 2: user udah liat preview & klik lanjut -> baru beneran ditulis.
  const confirmUpload = async () => {
    if (!preview || !file) return;
    setBusy(true);
    const { data: batch, error: bErr } = await supabase
      .from("upload_batches")
      .insert({
        kind: "delivery",
        client_id: clientId || null,
        filename: file.name,
        row_count: preview.records.length,
      })
      .select()
      .single();
    if (bErr) {
      setBusy(false);
      return toast.error(bErr.message);
    }

    const records = preview.records.map((r) => ({ ...r, batch_id: batch.id }));

    // TIMPA: hapus dulu versi lama di DB (berdasar Dash ID) buat baris yang udah ada,
    // biar diganti sama data baru — bukan dobel, dan status/data ke-refresh.
    if (preview.overwriteDashIds.length) {
      for (let i = 0; i < preview.overwriteDashIds.length; i += 200) {
        const chunk = preview.overwriteDashIds.slice(i, i + 200);
        const { error: delErr } = await (supabase as any)
          .from("delivery_records")
          .delete()
          .in("dash_delivery_id", chunk);
        if (delErr) {
          setBusy(false);
          return toast.error(`Gagal hapus data lama: ${delErr.message}`);
        }
      }
    }

    // Insert per gelombang 500 baris. Kalau 1 gelombang gagal, JANGAN berhenti
    // total (gelombang sebelumnya udah kepalang masuk & ga bisa ditarik lagi,
    // menghentikan proses cuma bikin sisa data ilang tanpa laporan jelas).
    // Sebagai gantinya: coba insert satu-satu di gelombang yang gagal, biar
    // 1 baris jelek ga ngorbanin ratusan baris baik lainnya di gelombang itu.
    let inserted = 0;
    const failedRows: { dash: string | null; error: string }[] = [];
    for (let i = 0; i < records.length; i += 500) {
      const chunk = records.slice(i, i + 500);
      const { error } = await (supabase as any).from("delivery_records").insert(chunk);
      if (!error) {
        inserted += chunk.length;
        continue;
      }

      // gelombang ini gagal → retry satu-satu buat isolasi baris yang bermasalah
      for (const row of chunk) {
        const { error: rowErr } = await (supabase as any).from("delivery_records").insert([row]);
        if (rowErr)
          failedRows.push({
            dash: (row as { dash_delivery_id?: string | null }).dash_delivery_id ?? null,
            error: rowErr.message,
          });
        else inserted++;
      }
    }

    if (failedRows.length > 0) {
      toast.error(
        `${inserted} baris berhasil masuk, TAPI ${failedRows.length} baris gagal (dilewati): ` +
          failedRows
            .slice(0, 5)
            .map((f) => `${f.dash ?? "(tanpa dash id)"} — ${f.error}`)
            .join(" | ") +
          (failedRows.length > 5 ? ` · +${failedRows.length - 5} lainnya` : ""),
      );
    }

    // Klasifikasi Delivery/Return otomatis buat tiap client yang kena upload ini
    const affectedClientIds = Array.from(
      new Set(
        records
          .map((r) => (r as { client_id?: string | null }).client_id)
          .filter((v): v is string => !!v),
      ),
    );
    let unclassifiedTotal = 0;
    if (affectedClientIds.length > 0) {
      try {
        const results = await classifyAllClients(affectedClientIds);
        unclassifiedTotal = results.reduce((s, r) => s + r.unclassifiedCount, 0);
      } catch (e) {
        toast.warning(`Klasifikasi Delivery/Return gagal jalan: ${(e as Error).message}`);
      }
    }

    setBusy(false);
    posthog.capture("delivery_data_uploaded", {
      row_count: inserted,
      overwrite_count: preview.overwriteCount,
      new_rider_count: preview.createdRiderCodes.length,
    });
    toast.success(
      `Berhasil upload ${inserted} record` +
        (preview.overwriteCount
          ? ` · ${preview.overwriteCount} data lama ditimpa (diperbarui)`
          : "") +
        (preview.fileRepeatCount
          ? ` · ${preview.fileRepeatCount} baris dobel di file di-skip`
          : "") +
        (preview.droppedStatusCount
          ? ` · ${preview.droppedStatusCount} baris status bukan Completed/Failed dibuang`
          : "") +
        (preview.createdRiderCodes.length
          ? ` · ${preview.createdRiderCodes.length} rider baru otomatis terdaftar`
          : ""),
    );
    if (preview.unmatchedClients.length > 0) {
      toast.warning(
        `Nama client tidak dikenal (baris ini ke-skip dari perhitungan sampai dibetulkan): ${preview.unmatchedClients.join(", ")}`,
      );
    }
    if (preview.anomalyCount > 0) {
      toast.warning(
        `${preview.anomalyCount} baris anomali (cuma salah satu ID cocok) — tetap terupload, tapi cek manual.`,
      );
    }
    if (unclassifiedTotal > 0) {
      toast.warning(
        `${unclassifiedTotal} baris ga bisa ditandain Delivery/Return (sender & receiver dua-duanya bukan titik pusat — kemungkinan kiriman outlet-ke-outlet). Cek & lengkapi data Sender/Receiver Name kalau ini seharusnya bukan kasus itu.`,
      );
    }
    setFile(null);
    setHeaders([]);
    setRows([]);
    setMapping({});
    setPreview(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-4">
        <button
          onClick={cleanDupes}
          disabled={cleaning}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          {cleaning ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Trash2 className="w-3.5 h-3.5" />
          )}
          Bersihkan Duplikat (data lama)
        </button>
        <button
          onClick={reclassifyAll}
          disabled={reclassifying || clients.length === 0}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          {reclassifying ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <RefreshCw className="w-3.5 h-3.5" />
          )}
          Hitung Ulang Delivery/Return (semua data lama)
        </button>
      </div>
      <div>
        <label className="text-sm font-medium">
          Client{" "}
          {hasClientColumn && (
            <span className="font-normal text-muted-foreground">
              (diabaikan — file sudah punya kolom client sendiri, per baris auto-detect)
            </span>
          )}
        </label>
        <ClientCombobox
          value={clientId}
          onChange={setClientId}
          disabled={hasClientColumn}
          placeholder="— pilih client —"
          className="mt-1 w-full max-w-sm text-sm py-2"
          options={clients.map((c) => ({ value: c.id, label: c.name }))}
        />
        <p className="text-xs text-muted-foreground mt-1">
          {hasClientColumn
            ? "Client dideteksi otomatis per baris dari file (1 file boleh campur banyak client)."
            : "Dipakai kalau file TIDAK punya kolom client sendiri. Kalau file punya kolom Provider Name/Client, itu otomatis kepakai duluan."}
        </p>
      </div>
      <label className="block">
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
          className="hidden"
        />
        <div className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:bg-muted/30">
          <Upload className="w-6 h-6 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm">
            {file ? <span className="font-medium">{file.name}</span> : "Klik untuk upload CSV"}
          </p>
        </div>
      </label>
      {headers.length > 0 && (
        <div className="rounded-lg border border-border p-4">
          <h4 className="text-sm font-semibold mb-2">Mapping Kolom ({rows.length} baris)</h4>
          <div className="grid sm:grid-cols-2 gap-2 text-sm">
            {DELIVERY_FIELDS.map((f) => (
              <div key={f} className="flex items-center gap-2">
                <span className="font-mono text-xs w-44">{f}</span>
                <select
                  value={mapping[f] ?? ""}
                  onChange={(e) => setMapping({ ...mapping, [f]: e.target.value })}
                  className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs"
                >
                  <option value="">—</option>
                  {headers.map((h, i) => (
                    <option key={`${h}-${i}`} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}
      {!hasDedupKeys && rows.length > 0 && (
        <p className="text-xs text-warning">
          Kolom Dash Delivery ID / Provider Order ID ga ke-map — deteksi duplikat ga bisa jalan buat
          upload ini.
        </p>
      )}
      <button
        onClick={analyze}
        disabled={analyzing || rows.length === 0 || (!clientId && !hasClientColumn)}
        className="inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm disabled:opacity-50"
      >
        {analyzing ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <FileText className="w-4 h-4" />
        )}{" "}
        {analyzing ? "Menganalisa…" : "Analisa & Preview"}
      </button>
      {preview && (
        <DeliveryPreviewModal
          preview={preview}
          busy={busy}
          onCancel={() => setPreview(null)}
          onConfirm={confirmUpload}
        />
      )}
    </div>
  );
}

function DeliveryPreviewModal({
  preview,
  busy,
  onCancel,
  onConfirm,
}: {
  preview: DeliveryPreview;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 grid place-items-center z-50 p-4" onClick={onCancel}>
      <div
        className="bg-card rounded-lg w-full max-w-lg p-5 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Preview Upload</h2>
          <button onClick={onCancel} className="p-1 text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 text-sm mb-3">
          <div className="rounded-md border border-border p-2.5">
            <div className="text-xs text-muted-foreground">Total baris di file</div>
            <div className="font-semibold">{preview.totalRows}</div>
          </div>
          <div className="rounded-md border border-border p-2.5">
            <div className="text-xs text-muted-foreground">Baru (belum ada)</div>
            <div className="font-semibold text-success">{preview.newCount}</div>
          </div>
          <div className="rounded-md border border-border p-2.5">
            <div className="text-xs text-muted-foreground">Ditimpa (data lama diperbarui)</div>
            <div className="font-semibold text-primary">{preview.overwriteCount}</div>
          </div>
          <div className="rounded-md border border-border p-2.5">
            <div className="text-xs text-muted-foreground">Anomali (cek manual)</div>
            <div className="font-semibold text-warning">{preview.anomalyCount}</div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Order yang Dash ID + Provider ID-nya sudah ada bakal{" "}
          <b className="text-primary">diperbarui</b> (data lama diganti yang baru), bukan
          digandakan.
          {preview.fileRepeatCount > 0 &&
            ` ${preview.fileRepeatCount} baris kembar di dalam file ini di-skip.`}
        </p>

        {preview.overwriteSamples.length > 0 && (
          <div className="mb-3">
            <p className="text-xs font-medium mb-1">
              Contoh yang bakal diperbarui (data lama ditimpa):
            </p>
            <div className="rounded-md border border-border max-h-32 overflow-y-auto text-xs font-mono">
              {preview.overwriteSamples.map((d, i) => (
                <div
                  key={i}
                  className="px-2 py-1 border-t border-border first:border-t-0 flex justify-between gap-2"
                >
                  <span className="truncate">
                    {d.dash} / {d.provider}
                  </span>
                  <span className="text-primary flex-shrink-0">→ diperbarui</span>
                </div>
              ))}
              {preview.overwriteCount > preview.overwriteSamples.length && (
                <div className="px-2 py-1 border-t border-border text-muted-foreground">
                  +{preview.overwriteCount - preview.overwriteSamples.length} lainnya
                </div>
              )}
            </div>
          </div>
        )}

        {preview.anomalySamples.length > 0 && (
          <div className="mb-3">
            <div className="flex items-center gap-1.5 text-warning text-xs font-medium mb-1">
              <AlertTriangle className="w-3.5 h-3.5" /> Cuma SALAH SATU ID yang cocok — bukan
              duplikat pasti, tetap terupload:
            </div>
            <div className="rounded-md border border-border max-h-32 overflow-y-auto text-xs font-mono">
              {preview.anomalySamples.map((d, i) => (
                <div key={i} className="px-2 py-1 border-t border-border first:border-t-0">
                  {d.dash} / {d.provider}
                </div>
              ))}
              {preview.anomalyCount > preview.anomalySamples.length && (
                <div className="px-2 py-1 border-t border-border text-muted-foreground">
                  +{preview.anomalyCount - preview.anomalySamples.length} lainnya
                </div>
              )}
            </div>
          </div>
        )}

        {preview.unmatchedClients.length > 0 && (
          <div className="mb-3 text-xs text-warning">
            Nama client tidak dikenal (baris ini ga dihitung): {preview.unmatchedClients.join(", ")}
          </div>
        )}
        {preview.createdRiderCodes.length > 0 && (
          <div className="mb-3 text-xs text-muted-foreground">
            {preview.createdRiderCodes.length} rider baru bakal otomatis terdaftar.
          </div>
        )}

        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onCancel} className="px-3 py-1.5 text-sm rounded border border-border">
            Batal
          </button>
          <button
            onClick={onConfirm}
            disabled={busy || preview.records.length === 0}
            className="px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground disabled:opacity-50"
          >
            {busy ? "Mengupload…" : `Lanjutkan Upload (${preview.records.length})`}
          </button>
        </div>
      </div>
    </div>
  );
}

function AttendanceUpload() {
  const posthog = usePostHog();
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<string[][]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase
      .from("clients")
      .select("id, name")
      .order("name")
      .then(({ data }) => setClients(data ?? []));
  }, []);

  const onFile = async (f: File) => {
    setFile(f);
    const text = await f.text();
    const parsed = parseCSV(text);
    if (!parsed.length) return toast.error("CSV kosong");
    setHeaders(parsed[0]);
    setRows(parsed.slice(1));
  };

  const parseDur = (s: string): number | null => {
    if (!s) return null;
    // "9h 51m" atau "9h" atau "51m"
    const hm = s.match(/(?:(\d+)h)?\s*(?:(\d+)m)?/);
    if (hm && (hm[1] || hm[2])) return parseInt(hm[1] || "0") * 60 + parseInt(hm[2] || "0");
    // "HH:MM"
    const colon = s.match(/(\d+):(\d+)/);
    if (colon) return parseInt(colon[1]) * 60 + parseInt(colon[2]);
    const n = parseInt(s);
    return isNaN(n) ? null : n;
  };

  // Kolom Date di file absensi operasional pakai format nama-hari + tanggal
  // Indonesia (mis. "Sabtu, 11 Juli 2026"), bukan ISO — dikirim mentah ke
  // Postgres bikin insert gagal (log_date bertipe date NOT NULL).
  const INDO_MONTHS: Record<string, string> = {
    januari: "01",
    februari: "02",
    maret: "03",
    april: "04",
    mei: "05",
    juni: "06",
    juli: "07",
    agustus: "08",
    september: "09",
    oktober: "10",
    november: "11",
    desember: "12",
  };
  const parseIndoDate = (raw: string): string | null => {
    const t = raw.trim();
    if (!t) return null;
    if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10); // udah ISO
    const m = t.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/); // "..., 11 Juli 2026" (nama hari di depan diabaikan)
    if (!m) return null;
    const month = INDO_MONTHS[m[2].toLowerCase()];
    return month ? `${m[3]}-${month}-${m[1].padStart(2, "0")}` : null;
  };

  const process = async () => {
    if (!file || rows.length === 0) return toast.error("Upload CSV dulu");
    setBusy(true);
    const { data: batch, error: bErr } = await supabase
      .from("upload_batches")
      .insert({ kind: "attendance", filename: file.name, row_count: rows.length })
      .select()
      .single();
    if (bErr) {
      setBusy(false);
      return toast.error(bErr.message);
    }

    const idx = (name: string) =>
      headers.findIndex((h) => h.toLowerCase().includes(name.toLowerCase()));
    const iCode = idx("kode"),
      iName = idx("name"),
      iClient = idx("client"),
      iPitstop = idx("pitstop"),
      iDate = idx("date"),
      iIn = idx("clock-in"),
      iOut = idx("clock-out"),
      iDur = idx("duration"),
      iOtp = idx("otp");

    // Rider berdiri sendiri dari kode MTR — sama seperti upload delivery,
    // kode yang belum terdaftar otomatis dibikinkan rider baru.
    const codes = rows.map((r) => r[iCode]);
    const namesByCode: Record<string, string> = {};
    if (iName >= 0)
      rows.forEach((r) => {
        if (r[iCode] && r[iName]) namesByCode[r[iCode]] = r[iName];
      });
    let riderMap: Map<string, string>;
    let createdCodes: string[];
    try {
      ({ map: riderMap, createdCodes } = await resolveOrCreateRiders(codes, namesByCode));
    } catch (e) {
      setBusy(false);
      return toast.error(`Gagal lookup rider: ${(e as Error).message}`);
    }

    // Cocokkan nama client di CSV ke client yang beneran ada di sistem —
    // dipakai Payroll Run buat milih aturan absensi (attendance_rules) yang
    // tepat per client, bukan nebak dari client_id tetap di rider.
    const clientByName = new Map(clients.map((c) => [c.name.trim().toLowerCase(), c.id]));
    const unmatchedClients = new Set<string>();

    // "Clock-out" berisi teks status kayak "(ongoing)" selama shift belum
    // selesai — bukan jam valid, dan bikin insert gagal (kolom TIME). Duration
    // ikut kosong buat baris begini, jadi validasi HH:MM di sini dan pakai
    // duration null sebagai sinyal "belum selesai" buat di-skip di bawah.
    const isValidTime = (s: string) => /^\d{1,2}:\d{2}(:\d{2})?$/.test(s.trim());

    // Format device/tracking mentah (mis. export "attendance data") gak punya
    // kolom Date/Duration sendiri — Clock-in/out-nya datetime penuh
    // ("2026-07-27 08:55:37"). Pecah jadi date+time di sini biar log_date &
    // duration bisa diturunkan otomatis, tanpa perlu convert file manual dulu.
    const DATETIME_RE = /^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2}(?::\d{2})?)/;
    const splitDateTime = (s: string) => {
      const m = s.trim().match(DATETIME_RE);
      return m ? { date: m[1], time: m[2] } : null;
    };

    let ongoingSkipped = 0;
    const allLogs = rows.flatMap((r) => {
      const code = r[iCode];
      const inRaw = (r[iIn] ?? "").trim();
      const outRaw = (r[iOut] ?? "").trim();
      const inDT = splitDateTime(inRaw);
      const outDT = outRaw ? splitDateTime(outRaw) : null;

      if (outRaw && !isValidTime(outRaw) && !outDT) {
        // shift belum selesai (mis. "(ongoing)") — skip, bukan force-insert
        ongoingSkipped++;
        return [];
      }

      let duration = parseDur(r[iDur] ?? "");
      let logDate = parseIndoDate(r[iDate] ?? "");
      let clockIn = inRaw || null;
      let clockOut = outRaw || null;
      if (inDT) {
        logDate = logDate || inDT.date;
        clockIn = inDT.time;
        if (outDT) {
          clockOut = outDT.time;
          if (duration == null) {
            const inMs = new Date(`${inDT.date}T${inDT.time}`).getTime();
            const outMs = new Date(`${outDT.date}T${outDT.time}`).getTime();
            duration = Math.round((outMs - inMs) / 60000);
          }
        }
      }
      if (duration == null) {
        ongoingSkipped++;
        return [];
      }
      const clientNameRaw = r[iClient] ?? null;
      let client_id: string | null = null;
      if (clientNameRaw) {
        const hit = clientByName.get(clientNameRaw.trim().toLowerCase());
        if (hit) client_id = hit;
        else unmatchedClients.add(clientNameRaw);
      }
      if (!client_id && clientId) client_id = clientId;
      const otpRaw = iOtp >= 0 ? (r[iOtp] ?? "").trim().toLowerCase() : "";
      const pitstopName = iPitstop >= 0 ? (r[iPitstop] ?? null) : null;
      return [{
        batch_id: batch.id,
        rider_id: code ? (riderMap.get(code) ?? null) : null,
        driver_code: code,
        client_name: clientNameRaw,
        pitstop_name: pitstopName,
        client_id,
        log_date: logDate || new Date().toISOString().slice(0, 10),
        clock_in: clockIn,
        clock_out: clockOut,
        duration_minutes: duration,
        is_absent: !inRaw,
        is_late: otpRaw === "late",
      }];
    });

    // Deteksi duplikat: kunci = driver_code + log_date + clock_in + duration_minutes.
    // SENGAJA bukan cuma driver_code + log_date — 1 rider BISA punya lebih dari
    // 1 shift asli dalam sehari (mis. double shift / cover shift orang lain,
    // masing-masing clock_in dan/atau durasinya beda), jadi baris-baris begitu
    // HARUS dua-duanya disimpan, bukan ditimpa satu sama lain. Yang dianggap
    // duplikat murni ("dibuang"/ditimpa) HANYA kalau ke-4 nilai itu sama persis
    // — itu berarti baris yang sama betul-betul terulang (mis. file yang sama
    // di-upload lagi), bukan shift yang berbeda.
    const keyOf = (code: string | null | undefined, date: string, clockIn: string | null, duration: number | null) =>
      `${code ?? ""}|${date}|${clockIn ?? ""}|${duration ?? ""}`;
    const seenInFile = new Set<string>();
    const logs: typeof allLogs = [];
    let fileRepeatCount = 0;
    for (const log of allLogs) {
      const key = keyOf(log.driver_code, log.log_date, log.clock_in, log.duration_minutes);
      if (log.driver_code && seenInFile.has(key)) {
        fileRepeatCount++;
        continue;
      }
      seenInFile.add(key);
      logs.push(log);
    }

    const codesForDedup = Array.from(
      new Set(logs.map((l) => l.driver_code).filter((c): c is string => !!c)),
    );
    const existing = await inChunks<{
      id: string;
      driver_code: string;
      log_date: string;
      clock_in: string | null;
      duration_minutes: number | null;
    }>("attendance_logs", "driver_code", codesForDedup, "id, driver_code, log_date, clock_in, duration_minutes");
    const existingByKey = new Map(
      existing.map((e) => [keyOf(e.driver_code, e.log_date, e.clock_in, e.duration_minutes), e.id]),
    );
    const overwriteIds = logs
      .map((l) => existingByKey.get(keyOf(l.driver_code, l.log_date, l.clock_in, l.duration_minutes)))
      .filter((id): id is string => !!id);

    if (overwriteIds.length) {
      for (let i = 0; i < overwriteIds.length; i += 200) {
        const chunk = overwriteIds.slice(i, i + 200);
        const { error: delErr } = await (supabase as any)
          .from("attendance_logs")
          .delete()
          .in("id", chunk);
        if (delErr) {
          setBusy(false);
          return toast.error(`Gagal timpa data lama: ${delErr.message}`);
        }
      }
    }

    let inserted = 0;
    for (let i = 0; i < logs.length; i += 500) {
      const chunk = logs.slice(i, i + 500);
      const { error } = await (supabase as any).from("attendance_logs").insert(chunk);
      if (error) {
        setBusy(false);
        return toast.error(error.message);
      }
      inserted += chunk.length;
    }
    setBusy(false);
    posthog.capture("attendance_data_uploaded", {
      row_count: inserted,
      overwrite_count: overwriteIds.length,
      new_rider_count: createdCodes.length,
      ongoing_skipped: ongoingSkipped,
    });
    toast.success(
      `Berhasil upload ${inserted} log absensi` +
        (overwriteIds.length ? ` · ${overwriteIds.length} data lama ditimpa (diperbarui)` : "") +
        (fileRepeatCount ? ` · ${fileRepeatCount} baris dobel di file di-skip` : "") +
        (ongoingSkipped ? ` · ${ongoingSkipped} shift masih ongoing di-skip` : "") +
        (createdCodes.length ? ` · ${createdCodes.length} rider baru otomatis terdaftar` : ""),
    );
    if (unmatchedClients.size > 0) {
      toast.warning(
        `Nama client tidak dikenal (aturan absensi mungkin salah pilih): ${Array.from(unmatchedClients).join(", ")}`,
      );
    }
    setFile(null);
    setHeaders([]);
    setRows([]);
  };

  return (
    <div className="space-y-4">
      <div className="text-xs text-muted-foreground">
        Format kolom: <code>Kode Mitra, Client Name, Date, Clock-in, Clock-out, Duration, OTP</code>{" "}
        (OTP: ONTIME/LATE — dipakai buat insentif ontime di Type E)
      </div>
      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1">
          Client (opsional — override jika CSV tidak punya kolom client)
        </label>
        <ClientCombobox
          value={clientId}
          onChange={setClientId}
          placeholder="— dari kolom CSV / kosongkan jika CSV sudah ada client —"
          className="w-full text-sm py-2"
          options={clients.map((c) => ({ value: c.id, label: c.name }))}
        />
      </div>
      <label className="block">
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
          className="hidden"
        />
        <div className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:bg-muted/30">
          <Upload className="w-6 h-6 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm">
            {file ? <span className="font-medium">{file.name}</span> : "Klik untuk upload CSV"}
          </p>
        </div>
      </label>
      {rows.length > 0 && (
        <p className="text-sm text-muted-foreground">{rows.length} baris siap diimport.</p>
      )}
      <button
        onClick={process}
        disabled={busy || rows.length === 0}
        className="inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm disabled:opacity-50"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}{" "}
        Proses Upload
      </button>
    </div>
  );
}
