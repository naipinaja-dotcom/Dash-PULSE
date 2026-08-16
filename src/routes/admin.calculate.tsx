import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePostHog } from "@posthog/react";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/admin-layout";
import { PageSizeSelect, PaginationBar } from "@/components/pagination-bar";
import { usePagination } from "@/lib/use-pagination";
import { RiderFeeDrilldown, type DrilldownRow } from "@/components/rider-fee-drilldown";
import { listPricingSchemes } from "@/lib/pricing-store";
import type { PricingScheme } from "@/lib/pricing-types";
import { pricingLabel } from "@/lib/pricing-types";
import {
  calcScheme,
  type DeliveryRow,
  type CalcResult,
  calcAttendanceScheme,
  type AttendanceLogRow,
  type AttendanceCalcResult,
  calcHybridScheme,
  type CombinedCalcResult,
  isCompleted,
} from "@/lib/pricing-calc";
import { formatRupiah } from "@/lib/format";
import { toast } from "sonner";
import { confirmDialog } from "@/components/confirm-dialog";
import { ClientCombobox } from "@/components/client-combobox";
import { DatePicker } from "@/components/date-picker";
import { resolveRiderIdentities } from "@/lib/rider-lookup";
import { findOrCreatePayrollRun, generatePayrollDetails } from "@/lib/payroll-generate";
import { loadLiveFeeDeliveries } from "@/lib/api/live-fee-deliveries.functions";
import { upsertLiveDeliveries } from "@/lib/sync-live-deliveries";
import { upsertLiveAttendance } from "@/lib/sync-live-attendance";
import { loadLiveFeeAttendance } from "@/lib/api/live-fee-attendance.functions";
import { loadApiProviders, type ApiProvider } from "@/lib/api/providers.functions";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { Loader2, Play, AlertTriangle, Info, Save, ChevronRight, Radio, Database } from "lucide-react";

export const Route = createFileRoute("/admin/calculate")({ component: CalculatePage });

type ClientLite = { id: string; name: string; provider_id?: number | null };

function firstOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
// Insert baris fee_calculation_audit_log + toast warning kalau gagal — dipakai
// commit() & commitInvoice(). Fee/invoice-nya sendiri udah kesimpen valid
// SEBELUM ini dipanggil, jadi audit log gagal itu sekunder: dikasih tau lewat
// warning (bukan error) biar user gak salah kira data utamanya ilang.
async function logFeeAudit(entry: {
  action: "commit_payroll" | "commit_invoice";
  client_id: string | null;
  scheme_id: string;
  scheme_name: string | null;
  scheme_snapshot: unknown;
  period_start: string;
  period_end: string;
  row_count: number;
  total_amount: number;
  committed_by: string | null;
  calc_table?: string;
  affected_row_ids?: unknown[];
}, successMessage: string) {
  const { error } = await (supabase as any).from("fee_calculation_audit_log").insert(entry);
  if (error) toast.warning(`${successMessage}, tapi audit log gagal disimpan: ${error.message}`);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function CalculatePage() {
  const { user } = useAuth();
  const { t } = useT();
  const posthog = usePostHog();
  const [clients, setClients] = useState<ClientLite[]>([]);
  const [schemes, setSchemes] = useState<PricingScheme[]>([]);
  const [clientId, setClientId] = useState("");
  const [schemeId, setSchemeId] = useState("");
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [running, setRunning] = useState(false);
  const [committing, setCommitting] = useState(false);
  // Lock sinkron (bukan cuma state `committing`) — dobel-klik cepat di
  // "Commit ke Payroll"/"Commit ke Invoice" bisa nembus sebelum re-render
  // pertama nyampein disabled ke tombol, karena setState gak langsung
  // keliatan di render yang sama. Ref di sini keupdate LANGSUNG, jadi klik
  // ke-2 dalam sepersekian detik ke-tolak jelas, bukan diam-diam bikin 2
  // baris fee_calculation_audit_log buat commit yang sama (lihat pola sama
  // di savingDeductionLock, admin.payroll.tsx).
  const commitLock = useRef(false);
  const [result, setResult] = useState<CalcResult | null>(null);
  const [attResult, setAttResult] = useState<AttendanceCalcResult | null>(null);
  const [combinedResult, setCombinedResult] = useState<CombinedCalcResult | null>(null);
  const [riderNames, setRiderNames] = useState<Record<string, string>>({});
  const [ranScheme, setRanScheme] = useState<PricingScheme | null>(null);
  const [syncing, setSyncing] = useState(false);
  // Daftar provider API — client ditautkan ke provider lewat clients.provider_id
  // (persisted, lihat migration clients_provider_id) kalau sudah pernah
  // di-link; fallback name-match (client disync dari API, jadi namanya sama)
  // buat client lama yang belum sempat di-link.
  const [providers, setProviders] = useState<ApiProvider[]>([]);
  const selectedClient = clients.find((c) => c.id === clientId) ?? null;
  const matchedProvider = selectedClient
    ? ((selectedClient.provider_id != null ? providers.find((p) => p.id === selectedClient.provider_id) : null) ??
        providers.find((p) => p.name.trim().toLowerCase() === selectedClient.name.trim().toLowerCase()) ??
        null)
    : null;
  const apiProviderId = matchedProvider?.id ?? null;
  // BU dari revenue_stream provider — kalau cuma 1 stream, pakai itu buat
  // mempersempit tarikan; kalau lebih, biarkan "Semua BU" (filter provider di sisi kita).
  const apiBusinessUnit =
    matchedProvider && matchedProvider.revenueStreams.length === 1
      ? matchedProvider.revenueStreams[0]
      : "";
  // Rincian per-baris (order/hari) per rider, dipakai buat drill-down preview
  // sebelum commit — lihat komentar di RiderFeeDrilldown.
  const [drilldown, setDrilldown] = useState<Record<string, DrilldownRow[]>>({});
  const [expandedRider, setExpandedRider] = useState<string | null>(null);
  const deliveryPager = usePagination(result?.perRider ?? [], 20);
  const attPager = usePagination(attResult?.perRider ?? [], 20);
  const combinedPager = usePagination(combinedResult?.perRider ?? [], 20);

  useEffect(() => {
    (supabase as any)
      .from("clients")
      .select("id, name, provider_id")
      .order("name")
      .then(({ data }: { data: ClientLite[] | null }) => setClients((data ?? []) as ClientLite[]));
    listPricingSchemes().then(setSchemes);
    // Provider API buat menautkan client↔provider by nama.
    (async () => {
      try {
        const { data: sess } = await supabase.auth.getSession();
        const token = sess.session?.access_token;
        if (!token) return;
        const r = await loadApiProviders({ data: { token } });
        setProviders(r.providers);
      } catch (e) {
        toast.error(`Gagal muat provider API: ${(e as Error).message}`);
      }
    })();
  }, []);

  // skema yang cocok untuk client terpilih (khusus client itu + yang "semua client")
  const matchingSchemes = useMemo(
    () => schemes.filter((s) => !clientId || s.client_id === clientId || s.client_id === null),
    [schemes, clientId],
  );

  const run = async () => {
    const scheme = schemes.find((s) => s.id === schemeId);
    if (!scheme) return toast.error("Pilih skema dulu");
    if (!scheme.params || scheme.params.version !== 1) {
      return toast.error("Skema ini versi lama — buka & simpan ulang di halaman Pricing dulu.");
    }
    if (from > to) return toast.error("Tanggal 'dari' tidak boleh setelah 'sampai'");

    setRunning(true);
    setResult(null);
    setAttResult(null);
    setCombinedResult(null);
    setDrilldown({});
    setExpandedRider(null);
    try {
      if (scheme.category === "hybrid") {
        // Fetch delivery records
        let dq = supabase
          .from("delivery_records")
          .select(
            "id, rider_id, driver_code, delivery_date, awb, district, distance_km, weight_kg, destination_address, service_type, status, delivery_type",
          )
          .gte("delivery_date", from)
          .lte("delivery_date", to);
        if (clientId) dq = dq.eq("client_id", clientId);
        const { data: deliveryData, error: deliveryErr } = await dq;
        if (deliveryErr) throw deliveryErr;

        // Fetch attendance logs for same range
        let aq = (supabase as any)
          .from("attendance_logs")
          .select("id, rider_id, driver_code, log_date, clock_in, duration_minutes, is_late, is_absent")
          .gte("log_date", from)
          .lte("log_date", to);
        if (clientId) aq = aq.eq("client_id", clientId);
        const { data: attData, error: attErr } = await aq;
        if (attErr) throw attErr;

        const deliveryRowsRaw = (deliveryData ?? []) as unknown as DeliveryRow[];
        const attRowsRaw = (attData ?? []) as AttendanceLogRow[];
        if (deliveryRowsRaw.length === 0)
          toast.message("Tidak ada data pengiriman di rentang & client ini.");
        if (attRowsRaw.length === 0)
          toast.message("Tidak ada data absensi — daily fee & bonus ontime tidak dihitung.");

        // resolve identitas rider dari rider_id ATAU fallback kode mitra (driver_code),
        // biar baris yang link rider_id-nya putus tetap kehitung & ketemu namanya.
        const { resolvedIdOf, nameOf } = await resolveRiderIdentities([
          ...deliveryRowsRaw,
          ...attRowsRaw,
        ]);
        const deliveryRows = deliveryRowsRaw.map((r) => ({ ...r, rider_id: resolvedIdOf(r) }));
        const attRows = attRowsRaw.map((r) => ({ ...r, rider_id: resolvedIdOf(r) }));

        const names: Record<string, string> = {};
        for (const r of [...deliveryRowsRaw, ...attRowsRaw]) {
          const key = resolvedIdOf(r) || r.driver_code || "(tanpa rider)";
          if (!names[key]) names[key] = nameOf(r);
        }
        setRiderNames(names);

        const res = calcHybridScheme(scheme.params, deliveryRows, attRows);
        setCombinedResult(res);
        setRanScheme(scheme);

        // Zip baris COMPLETED (urutan sama seperti dipakai calcHybridScheme
        // secara internal) dengan res.perRow buat dapetin km/kg per baris —
        // engine-nya sendiri gak nyimpen km/kg di output, cuma fee.
        const completedHybrid = deliveryRows.filter((r) => isCompleted(r));
        const ddHybrid: Record<string, DrilldownRow[]> = {};
        completedHybrid.forEach((r, i) => {
          const key = r.rider_id || r.driver_code || "(tanpa rider)";
          const rf = res.perRow[i];
          if (!rf) return;
          (ddHybrid[key] ??= []).push({ date: r.delivery_date, km: r.distance_km, kg: r.weight_kg, fee: rf.fee });
        });
        setDrilldown(ddHybrid);
      } else if (scheme.category === "attendance") {
        // Hitung SELALU baca dari attendance_logs (DB) — sumber tunggal.
        // Client dengan provider API perlu di-"Tarik & Sync dari API" dulu
        // (tombol di atas) buat nyegerin data DB-nya sebelum Hitung.
        let q = (supabase as any)
          .from("attendance_logs")
          .select(
            "id, rider_id, driver_code, log_date, clock_in, duration_minutes, is_late, is_absent",
          )
          .gte("log_date", from)
          .lte("log_date", to);
        if (clientId) q = q.eq("client_id", clientId);
        const { data, error } = await q;
        if (error) throw error;
        const rowsPlain = (data ?? []) as AttendanceLogRow[];
        if (rowsPlain.length === 0)
          toast.message("Tidak ada data absensi di rentang & client ini.");

        // STEP 2-3: resolve identitas rider dari rider_id ATAU fallback kode mitra,
        // biar baris yang link rider_id-nya putus tetap kehitung & ketemu namanya.
        const { resolvedIdOf, nameOf } = await resolveRiderIdentities(rowsPlain);
        const rows = rowsPlain.map((r) => ({ ...r, rider_id: resolvedIdOf(r) }));

        const names: Record<string, string> = {};
        for (const r of rowsPlain) {
          const key = resolvedIdOf(r) || r.driver_code || "(tanpa rider)";
          if (!names[key]) names[key] = nameOf(r);
        }
        setRiderNames(names);

        // Kalau delivery_component aktif, fetch delivery_records juga
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const delivCfg = (scheme.params.config as any)?.delivery_component;
        let deliveryRowsForAtt: DeliveryRow[] = [];
        if (delivCfg?.enabled) {
          let dq = supabase
            .from("delivery_records")
            .select(
              "id, rider_id, driver_code, delivery_date, awb, district, distance_km, weight_kg, destination_address, service_type, status, delivery_type",
            )
            .gte("delivery_date", from)
            .lte("delivery_date", to);
          if (clientId) dq = dq.eq("client_id", clientId);
          const { data: dData } = await dq;
          const dPlain = (dData ?? []) as unknown as DeliveryRow[];
          const { resolvedIdOf: resolveD } = await resolveRiderIdentities(dPlain);
          deliveryRowsForAtt = dPlain.map((r) => ({
            ...r,
            rider_id: resolveD(r),
          })) as unknown as DeliveryRow[];
        }

        const res = calcAttendanceScheme(
          scheme.params,
          rows,
          deliveryRowsForAtt.length ? deliveryRowsForAtt : undefined,
        );
        setAttResult(res);
        setRanScheme(scheme);

        // attResult.perRow = logs.map(...) — 1:1 sama urutan `rows`, gak ada
        // filter, jadi zip langsung by index (bukan km/kg, attendance pakai
        // status hadir sebagai "note").
        const ddAtt: Record<string, DrilldownRow[]> = {};
        rows.forEach((r, i) => {
          const key = r.rider_id || r.driver_code || "(tanpa rider)";
          const rf = res.perRow[i];
          if (!rf) return;
          const note = r.is_absent ? "ABSEN" : r.is_late ? "LATE" : "ONTIME";
          (ddAtt[key] ??= []).push({ date: r.log_date, note, fee: rf.fee });
        });
        setDrilldown(ddAtt);
      } else {
        // Hitung SELALU baca dari delivery_records (DB) — sumber tunggal.
        // Client dengan provider API perlu di-"Tarik & Sync dari API" dulu
        // (tombol di atas) buat nyegerin data DB-nya sebelum Hitung.
        let q = supabase
          .from("delivery_records")
          .select(
            "id, rider_id, driver_code, delivery_date, awb, district, distance_km, weight_kg, destination_address, service_type, status, delivery_type",
          )
          .gte("delivery_date", from)
          .lte("delivery_date", to);
        if (clientId) q = q.eq("client_id", clientId);
        const { data, error } = await q;
        if (error) throw error;
        const rowsPlain = (data ?? []) as unknown as DeliveryRow[];
        if (rowsPlain.length === 0)
          toast.message("Tidak ada data pengiriman di rentang & client ini.");

        // STEP 2-3: resolve identitas rider dari rider_id ATAU fallback kode mitra,
        // biar baris yang link rider_id-nya putus tetap kehitung & ketemu namanya.
        const { resolvedIdOf, nameOf } = await resolveRiderIdentities(rowsPlain);
        const rows = rowsPlain.map((r) => ({
          ...r,
          rider_id: resolvedIdOf(r),
        })) as unknown as DeliveryRow[];

        // map nama rider untuk tampilan
        const names: Record<string, string> = {};
        for (const r of rowsPlain) {
          const key = resolvedIdOf(r) || r.driver_code || "(tanpa rider)";
          if (!names[key]) names[key] = nameOf(r);
        }
        setRiderNames(names);

        const res = calcScheme(scheme.params, rows);
        setResult(res);
        setRanScheme(scheme);

        // Zip baris COMPLETED (urutan sama seperti dipakai calcScheme secara
        // internal) dengan res.perRow buat dapetin km/kg per baris.
        const completedDeliv = rows.filter((r) => isCompleted(r));
        const ddDeliv: Record<string, DrilldownRow[]> = {};
        completedDeliv.forEach((r, i) => {
          const key = r.rider_id || r.driver_code || "(tanpa rider)";
          const rf = res.perRow[i];
          if (!rf) return;
          (ddDeliv[key] ??= []).push({ date: r.delivery_date, km: r.distance_km, kg: r.weight_kg, fee: rf.fee });
        });
        setDrilldown(ddDeliv);
      }
      posthog.capture("fee_calculation_run", {
        category: scheme.category,
        subtype: scheme.subtype ?? null,
        scheme_for: scheme.scheme_for,
        period_from: from,
        period_to: to,
        has_client: !!clientId,
      });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  // Tarik data terbaru dari mgmt API & simpan ke delivery_records/
  // attendance_logs — SATU-satunya cara nyegerin data buat client yang
  // ter-integrasi API. Fee & Payroll Run SENGAJA TIDAK dibikin di sini
  // (beda dari versi lama) — begitu sync selesai, auto re-run Hitung yang
  // SELALU baca dari DB, biar delivery_records/attendance_logs tetap
  // SATU-satunya sumber kebenaran. Sebelumnya ada 2 jalur (live vs DB) yang
  // bisa beda hasil kalau salah satu ke-update (mis. district) tapi yang
  // lain nggak — itu yang bikin kejadian "sudah difix tapi Hitung Fee masih
  // 0" walau delivery_records-nya udah bener.
  const syncFromApi = async () => {
    const scheme = schemes.find((s) => s.id === schemeId);
    if (!scheme) return toast.error("Pilih skema dulu");
    if (!clientId) return toast.error("Pilih client dulu.");
    if (!apiProviderId) return toast.error("Client ini belum ter-integrasi API.");
    if (from > to) return toast.error("Tanggal 'dari' tidak boleh setelah 'sampai'");

    setSyncing(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token ?? "";
      if (scheme.category === "attendance") {
        const live = await loadLiveFeeAttendance({
          data: { token, providerId: apiProviderId, from, to, shifts: (scheme.params.config as any)?.shifts ?? [] },
        });
        if (live.rows.length === 0)
          return toast.message("API tersambung, tapi tidak ada absensi (clock-out) di rentang ini.");
        if (
          !(await confirmDialog({
            title: "Sync absensi ke database?",
            description: `${live.rows.length} shift absensi dari API akan disimpan/menimpa attendance_logs client ini periode ${from} → ${to}.`,
            confirmText: "Sync",
            danger: false,
          }))
        )
          return;
        const res = await upsertLiveAttendance(clientId, live.rows, from, to, `API sync attendance · ${from}..${to}`);
        posthog.capture("live_attendance_synced", {
          client_id: clientId, provider_id: apiProviderId, inserted: res.inserted, period_from: from, period_to: to,
        });
        toast.success(
          `Sync selesai: ${res.inserted} shift tersimpan${res.ridersCreated ? `, ${res.ridersCreated} rider baru` : ""}.`,
        );
      } else {
        const live = await loadLiveFeeDeliveries({
          data: { token, providerId: apiProviderId, businessUnit: apiBusinessUnit || null, from, to },
        });
        if (live.rows.length === 0)
          return toast.message("API tersambung, tapi tidak ada pengiriman di rentang & provider ini.");
        const ALLOWED = new Set(["COMPLETED", "FAILED"]);
        const usable = live.rows.filter((r) => ALLOWED.has(String(r.status ?? "").trim().toUpperCase()));
        const dropped = live.rows.length - usable.length;
        if (
          !(await confirmDialog({
            title: "Sync ke database?",
            description: `${usable.length} pengiriman (COMPLETED/FAILED) dari API akan disimpan/di-update ke delivery_records client ini${dropped > 0 ? `. ${dropped} baris status transien dilewati` : ""}.`,
            confirmText: "Sync",
            danger: false,
          }))
        )
          return;
        const res = await upsertLiveDeliveries(clientId, live.rows, `API sync · ${live.meta.business_unit} · ${from}..${to}`);
        posthog.capture("live_deliveries_synced", {
          client_id: clientId, provider_id: apiProviderId, inserted: res.inserted, overwritten: res.overwritten,
          dropped: res.dropped, period_from: from, period_to: to,
        });
        toast.success(
          `Sync selesai: ${res.inserted} baris tersimpan` +
            (res.overwritten ? `, ${res.overwritten} lama ditimpa` : "") +
            (res.ridersCreated ? `, ${res.ridersCreated} rider baru` : "") +
            (res.dropped ? `, ${res.dropped} status transien dilewati` : "") +
            ".",
        );
      }
      await run();
    } catch (e) {
      toast.error(`Sync gagal: ${(e as Error).message}`);
    } finally {
      setSyncing(false);
    }
  };

  const commit = async () => {
    if (!ranScheme || ranScheme.scheme_for !== "rider") return;
    const isAttendance = ranScheme.category === "attendance";
    const isCombined = ranScheme.category === "hybrid";
    const rows = isAttendance
      ? (attResult?.perRow.filter((r) => r.id) ?? [])
      : isCombined
        ? (combinedResult?.perRow.filter((r) => r.id) ?? [])
        : (result?.perRow.filter((r) => r.id) ?? []);
    if (rows.length === 0) return toast.error("Tidak ada baris untuk disimpan.");
    const table = isAttendance ? "attendance_logs" : "delivery_records";

    if (commitLock.current) return toast.error("Masih memproses permintaan sebelumnya, tunggu sebentar.");
    commitLock.current = true;
    setCommitting(true);
    try {
      // Begitu ada payroll run buat client+periode ini yang UDAH di-publish,
      // angkanya dianggap final (udah dikirim/kepake buat slip gaji rider) —
      // Hitung Fee ulang gak boleh diam-diam nimpa data sumbernya. Selama belum
      // published (masih draft/finalized), commit ulang tetap boleh.
      let publishedQ = (supabase as any).from("payroll_runs").select("id, name")
        .eq("period_start", from).eq("period_end", to).eq("status", "published");
      publishedQ = clientId ? publishedQ.eq("client_id", clientId) : publishedQ.is("client_id", null);
      const { data: publishedRun } = await publishedQ.maybeSingle();
      if (publishedRun) {
        toast.error(
          `Periode ini udah di-publish sebagai payroll "${publishedRun.name}" — gak bisa commit ulang, angkanya udah final. Batalin publish run itu dulu di Payroll Run kalau emang perlu dikoreksi.`,
        );
        return;
      }

      if (
        !(await confirmDialog({
          title: "Simpan hasil fee?",
          description: `Fee akan disimpan ke ${rows.length} baris ${isAttendance ? "absensi" : "pengiriman"}. Angka ini yang akan dipakai Payroll Run.`,
          confirmText: "Simpan",
          danger: false,
        }))
      )
        return;
      const chunkSize = 100;
      let done = 0;
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const res = await Promise.all(
          chunk.map((r) =>
            (supabase as any)
              .from(table)
              .update({ fee: r.fee })
              .eq("id", r.id as string),
          ),
        );
        const err = res.find((x: any) => x.error)?.error;
        if (err) throw err;
        done += chunk.length;
      }
      // Audit trail: catat siapa yang commit, kapan, skema/config PERSIS yang
      // dipakai (snapshot, bukan referensi hidup ke pricing_schemes yang bisa
      // berubah belakangan), dan total fee — biar bisa ditelusuri kalau nanti
      // ada yang nanya "kenapa fee-nya segini".
      const totalFee = rows.reduce((s, r) => s + Number(r.fee || 0), 0);
      // affected_row_ids: PERSIS baris yang barusan di-update — dipakai buat
      // "Reject" (salah pilih tanggal/client, udah keburu commit) biar bisa
      // di-reset balik ke fee=0 tanpa nyenggol baris lain yang gak terkait.
      await logFeeAudit({
        action: "commit_payroll",
        client_id: clientId || null,
        scheme_id: ranScheme.id,
        scheme_name: ranScheme.name ?? null,
        scheme_snapshot: ranScheme.params,
        period_start: from, period_end: to,
        row_count: done, total_amount: totalFee,
        calc_table: table,
        affected_row_ids: rows.map((r) => r.id).filter(Boolean),
        committed_by: user?.id ?? null,
      }, "Fee tersimpan");

      posthog.capture("fee_committed_to_payroll", {
        category: ranScheme.category,
        subtype: ranScheme.subtype ?? null,
        row_count: done,
        period_from: from,
        period_to: to,
      });

      // Auto-bikin/reuse Payroll Run buat client+periode ini, dan langsung
      // generate detail-nya — biar begitu balik ke halaman Payroll Run, run-nya
      // udah ADA dan udah SIAP direview, tanpa langkah "Buat Run" manual lagi.
      const clientName = clientId ? (clients.find((c) => c.id === clientId)?.name ?? "Client") : "Semua Client";
      const run = await findOrCreatePayrollRun({ clientId: clientId || null, clientName, periodStart: from, periodEnd: to });
      await generatePayrollDetails(run);

      toast.success(`Fee tersimpan ke ${done} baris. Payroll Run "${clientName}" siap direview.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCommitting(false);
      commitLock.current = false;
    }
  };

  const commitInvoice = async () => {
    if (!ranScheme || ranScheme.scheme_for !== "client" || !clientId) return;
    const isAttendance = ranScheme.category === "attendance";
    const isCombined = ranScheme.category === "hybrid";
    const r = isAttendance ? attResult : isCombined ? combinedResult : result;
    if (!r) return;
    // r.grandTotal udah nerapin billing_addons buat ketiga kategori (delivery/
    // attendance/hybrid) — sebelumnya di sini cuma baca `result?.billing`
    // (state skema delivery) walau skema yang lagi jalan attendance/hybrid,
    // jadi billing-nya kebaca dari run yang gak nyambung sama sekali.
    const total = r.grandTotal;
    if (commitLock.current) return toast.error("Masih memproses permintaan sebelumnya, tunggu sebentar.");
    commitLock.current = true;
    setCommitting(true);
    try {
      if (
        !(await confirmDialog({
          title: "Simpan sebagai invoice?",
          description: `Invoice client periode ${from} → ${to} sebesar ${formatRupiah(total)} akan disimpan. Bisa dilihat & di-export di halaman Invoices.`,
          confirmText: "Simpan",
          danger: false,
        }))
      )
        return;
      const { error } = await (supabase as any).from("invoice_details").insert({
        client_id: clientId,
        invoice_date: to,
        period_start: from,
        period_end: to,
        calculation_type: ranScheme.params.type,
        scheme_name: ranScheme.name ?? null,
        base_amount: r.subtotal,
        surcharge_amount: total - r.subtotal,
        total_amount: total,
        status: "draft",
        detail_breakdown: {
          per_rider: r.perRider,
          billing: r.billing ?? null,
          warnings: r.warnings,
        },
      });
      if (error) throw error;
      // Audit trail — sama seperti commit() di atas, snapshot skema + siapa/kapan.
      await logFeeAudit({
        action: "commit_invoice",
        client_id: clientId,
        scheme_id: ranScheme.id,
        scheme_name: ranScheme.name ?? null,
        scheme_snapshot: ranScheme.params,
        period_start: from, period_end: to,
        row_count: r.perRider.length, total_amount: total,
        committed_by: user?.id ?? null,
      }, "Invoice tersimpan");
      posthog.capture("invoice_committed", {
        category: ranScheme.category,
        subtype: ranScheme.subtype ?? null,
        total_amount: total,
        period_from: from,
        period_to: to,
      });
      toast.success("Invoice tersimpan. Lihat di halaman Invoices.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCommitting(false);
      commitLock.current = false;
    }
  };

  return (
    <AdminLayout
      title={t("calc.title")}
      subtitle="Hitung fee dari data pengiriman pakai skema pricing (preview sebelum simpan)"
    >
      {/* Kontrol */}
      <div className="rounded-xl border-2 border-border-strong bg-card shadow-[5px_5px_0_0_var(--color-border-strong)] p-5 mb-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
        <div className="flex flex-col gap-1.5">
          <label className="font-medium text-muted-foreground">Client</label>
          <ClientCombobox
            value={clientId}
            onChange={(v) => {
              setClientId(v);
              setSchemeId("");
            }}
            placeholder="— pilih client —"
            className="w-full text-sm py-2"
            options={clients.map((c) => ({ value: c.id, label: c.name }))}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="font-medium text-muted-foreground">Skema</label>
          <ClientCombobox
            value={schemeId}
            onChange={setSchemeId}
            placeholder="— pilih skema —"
            className="w-full text-sm py-2"
            searchPlaceholder="Cari skema..."
            emptyText="Skema tidak ditemukan"
            itemLabel="skema"
            options={matchingSchemes.map((s) => ({
              value: s.id,
              label: `${s.name} · ${s.scheme_for === "client" ? "Client" : "Rider"} · ${pricingLabel(s.category, s.subtype)}`,
            }))}
          />
        </div>

        {/* Status integrasi API (mapping di-set di menu Clients) — Hitung SELALU
            baca dari DB (delivery_records/attendance_logs); tombol "Tarik &
            Sync dari API" di bawah cuma buat nyegerin DB-nya dulu. */}
        {clientId && (
          <div className="md:col-span-2 flex flex-wrap items-start gap-2 text-xs text-muted-foreground">
            <Radio className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            {apiProviderId ? (
              <>
                <span>
                  Client ini ter-integrasi API — provider{" "}
                  <code className="font-mono">#{apiProviderId}</code>
                  {apiBusinessUnit ? (
                    <>
                      {" "}
                      · BU <code className="font-mono">{apiBusinessUnit}</code>
                    </>
                  ) : (
                    <> · semua BU</>
                  )}
                  . Hitung baca dari database — klik <strong>Tarik & Sync dari API</strong> dulu kalau mau nyegerin.
                </span>
                <button
                  type="button"
                  onClick={syncFromApi}
                  disabled={syncing || !schemeId}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-primary/40 text-primary px-2.5 py-1 text-xs font-medium disabled:opacity-50 flex-shrink-0"
                >
                  {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Database className="w-3.5 h-3.5" />}
                  {syncing ? "Menyinkron…" : "Tarik & Sync dari API"}
                </button>
              </>
            ) : (
              <span>
                Client ini belum di-mapping ke provider API — Hitung Fee pakai data upload
                (delivery_records). Atur mapping di menu <strong>Clients</strong>.
              </span>
            )}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label className="font-medium text-muted-foreground">Dari Tanggal</label>
          <DatePicker value={from} onChange={setFrom} className="w-full" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="font-medium text-muted-foreground">Sampai Tanggal</label>
          <DatePicker value={to} onChange={setTo} className="w-full" />
        </div>
        <div className="md:col-span-2">
          <button
            onClick={run}
            disabled={running || !schemeId}
            className="inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            {running ? "Menghitung…" : "Hitung"}
          </button>
        </div>
      </div>

      {result && ranScheme && (
        <>
          {/* Ringkasan */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <SummaryCard label="Baris dihitung" value={String(result.completedRows)} />
            <SummaryCard label="Baris di-skip" value={String(result.skippedRows)} />
            <SummaryCard label="Subtotal" value={formatRupiah(result.subtotal)} />
            <SummaryCard
              label={ranScheme.scheme_for === "client" ? "Total Tagihan" : "Total Fee Rider"}
              value={formatRupiah(result.grandTotal)}
              highlight
            />
          </div>

          {/* Warning */}
          {result.warnings.length > 0 && (
            <div className="rounded-md border-[3px] border-border-strong bg-warning shadow-[6px_6px_0_0_var(--color-border-strong)] px-3.5 py-2.5 mb-4 flex items-start gap-2.5 text-xs text-warning-foreground">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <div>
                {result.warnings.map((w, i) => (
                  <div key={i}>{w}</div>
                ))}
              </div>
            </div>
          )}

          {/* Rider yang ordernya di-skip (belum COMPLETED) — biar finance tau
              rider itu ADA tapi belum dibayar, bukan hilang dari data. */}
          {result.skippedPerRider.length > 0 && (
            <div className="rounded-md border border-border bg-card px-3.5 py-2.5 mb-4 text-xs">
              <div className="flex items-center gap-2 font-medium mb-1.5 text-muted-foreground">
                <Info className="w-4 h-4 flex-shrink-0" />
                Rider dengan order belum COMPLETED (belum dibayar, bukan hilang):
              </div>
              <div className="max-h-40 overflow-y-auto space-y-0.5">
                {result.skippedPerRider.map((s, i) => (
                  <div key={i} className="flex justify-between gap-3">
                    <span className="font-medium">{riderNames[s.rider] ?? s.rider}</span>
                    <span className="text-muted-foreground tabular-nums whitespace-nowrap">
                      {s.count} order ·{" "}
                      {Object.entries(s.statuses)
                        .map(([st, n]) => `${st} ${n}×`)
                        .join(", ")}
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-muted-foreground mt-1.5">
                Nanti kalau statusnya udah COMPLETED & data di-upload ulang, otomatis kehitung.
              </p>
            </div>
          )}

          {/* Anomali */}
          {result.anomalies.length > 0 && (
            <div className="rounded-md border-[3px] border-border-strong bg-warning shadow-[6px_6px_0_0_var(--color-border-strong)] px-3.5 py-2.5 mb-4 text-xs text-warning-foreground">
              <div className="flex items-center gap-2 font-medium mb-1.5">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {result.anomalies.length} baris
                anomali terdeteksi — cek manual, tidak otomatis di-skip
              </div>
              <div className="max-h-40 overflow-y-auto space-y-0.5">
                {result.anomalies.slice(0, 50).map((a, i) => (
                  <div key={i} className="font-mono">
                    {riderNames[a.rider] ?? a.rider} · {a.date}
                    {a.awb ? ` · ${a.awb}` : ""} — {a.detail}
                  </div>
                ))}
                {result.anomalies.length > 50 && <div>+{result.anomalies.length - 50} lainnya</div>}
              </div>
            </div>
          )}

          {/* Rincian per rider */}
          {result.perRider.length > 0 && (
            <div className="flex justify-end mb-2">
              <PageSizeSelect
                pageSize={deliveryPager.pageSize}
                setPageSize={deliveryPager.setPageSize}
              />
            </div>
          )}
          <div className="rounded-lg border border-border overflow-hidden mb-2">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="p-3">Rider</th>
                  <th className="p-3 text-right">Unit</th>
                  <th className="p-3 text-right">Base</th>
                  <th className="p-3 text-right">Add-KG</th>
                  <th className="p-3 text-right">Multi-drop</th>
                  <th className="p-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {result.perRider.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-muted-foreground">
                      Tidak ada hasil.
                    </td>
                  </tr>
                ) : (
                  deliveryPager.paged.map((l) => (
                    <Fragment key={l.rider}>
                      <tr className="border-t border-border">
                        <td className="p-3 font-medium">
                          <button
                            onClick={() => setExpandedRider(expandedRider === l.rider ? null : l.rider)}
                            className="flex items-center gap-1.5 text-left hover:text-primary"
                          >
                            <ChevronRight
                              className={`w-3.5 h-3.5 flex-shrink-0 transition-transform ${expandedRider === l.rider ? "rotate-90" : ""}`}
                            />
                            {riderNames[l.rider] ?? l.rider}
                          </button>
                        </td>
                        <td className="p-3 text-right text-muted-foreground">{l.units}</td>
                        <td className="p-3 text-right">{formatRupiah(l.base)}</td>
                        <td className="p-3 text-right">{l.add_kg ? formatRupiah(l.add_kg) : "—"}</td>
                        <td className="p-3 text-right">
                          {l.multi_drop ? formatRupiah(l.multi_drop) : "—"}
                        </td>
                        <td className="p-3 text-right font-semibold">{formatRupiah(l.total)}</td>
                      </tr>
                      {expandedRider === l.rider && (
                        <tr className="bg-muted/30">
                          <td colSpan={6} className="px-4 py-3">
                            <RiderFeeDrilldown rows={drilldown[l.rider] ?? []} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {result.perRider.length > 0 && (
            <div className="mb-4">
              <PaginationBar
                page={deliveryPager.page}
                totalPages={deliveryPager.totalPages}
                setPage={deliveryPager.setPage}
                from={deliveryPager.from}
                to={deliveryPager.to}
                total={deliveryPager.total}
              />
            </div>
          )}

          {/* Billing breakdown (client) */}
          {result.billing && (
            <div className="rounded-lg border border-border bg-card p-4 mb-4 text-sm max-w-sm">
              <p className="font-medium mb-2">Rincian Tagihan Client</p>
              <Line label="Subtotal" value={formatRupiah(result.subtotal)} />
              {result.billing.floored && <Line label="→ dinaikkan ke Min Charge" value="" muted />}
              <Line label="+ Admin Fee" value={formatRupiah(result.billing.admin_fee)} />
              <Line label="+ PPN" value={formatRupiah(result.billing.ppn)} />
              <div className="border-t border-border mt-2 pt-2">
                <Line label="Total Tagihan" value={formatRupiah(result.billing.final)} bold />
              </div>
            </div>
          )}

          {/* Commit */}
          <CommitPanel
            ranScheme={ranScheme}
            committing={committing}
            onCommit={commit}
            onCommitInvoice={commitInvoice}
            riderMessage={
              <>
                Cek dulu angkanya di atas. Kalau udah bener, <strong>Commit</strong> untuk simpan
                fee ke data pengiriman — angka ini yang dipungut <strong>Payroll Run</strong>.
              </>
            }
            clientMessage={
              <>
                Skema ini <strong>Client (revenue)</strong>. Cek dulu angkanya di atas, lalu{" "}
                <strong>Commit</strong> untuk simpan sebagai invoice periode ini — bisa dilihat &
                di-export di halaman <strong>Invoices</strong>.
              </>
            }
          />
        </>
      )}

      {combinedResult && ranScheme && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <SummaryCard label="Baris dihitung" value={String(combinedResult.completedRows)} />
            <SummaryCard label="Baris di-skip" value={String(combinedResult.skippedRows)} />
            <SummaryCard label="Subtotal" value={formatRupiah(combinedResult.subtotal)} />
            <SummaryCard
              label={ranScheme.scheme_for === "client" ? "Total Tagihan" : "Total Fee Rider"}
              value={formatRupiah(combinedResult.grandTotal)}
              highlight
            />
          </div>
          {combinedResult.billing && (
            <div className="rounded-md border border-border bg-card px-4 py-3 mb-4 text-sm space-y-1">
              <Line label="Subtotal" value={formatRupiah(combinedResult.subtotal)} />
              {combinedResult.billing.floored && <Line label="→ dinaikkan ke Min Charge" value="" muted />}
              <Line label="+ Admin Fee" value={formatRupiah(combinedResult.billing.admin_fee)} />
              <Line label="+ PPN" value={formatRupiah(combinedResult.billing.ppn)} />
              <div className="border-t border-border mt-2 pt-2">
                <Line label="Total Tagihan" value={formatRupiah(combinedResult.billing.final)} bold />
              </div>
            </div>
          )}

          {combinedResult.warnings.length > 0 && (
            <div className="rounded-md border-[3px] border-border-strong bg-warning shadow-[6px_6px_0_0_var(--color-border-strong)] px-3.5 py-2.5 mb-4 flex items-start gap-2.5 text-xs text-warning-foreground">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <div>
                {combinedResult.warnings.map((w, i) => (
                  <div key={i}>{w}</div>
                ))}
              </div>
            </div>
          )}

          {combinedResult.skippedPerRider.length > 0 && (
            <div className="rounded-md border border-border bg-card px-3.5 py-2.5 mb-4 text-xs">
              <div className="flex items-center gap-2 font-medium mb-1.5 text-muted-foreground">
                <Info className="w-4 h-4 flex-shrink-0" />
                Rider dengan order belum COMPLETED:
              </div>
              <div className="max-h-40 overflow-y-auto space-y-0.5">
                {combinedResult.skippedPerRider.map((s, i) => (
                  <div key={i} className="flex justify-between gap-3">
                    <span className="font-medium">{riderNames[s.rider] ?? s.rider}</span>
                    <span className="text-muted-foreground tabular-nums whitespace-nowrap">
                      {s.count} order ·{" "}
                      {Object.entries(s.statuses)
                        .map(([st, n]) => `${st} ${n}×`)
                        .join(", ")}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {combinedResult.anomalies.length > 0 && (
            <div className="rounded-md border-[3px] border-border-strong bg-warning shadow-[6px_6px_0_0_var(--color-border-strong)] px-3.5 py-2.5 mb-4 text-xs text-warning-foreground">
              <div className="flex items-center gap-2 font-medium mb-1.5">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />{" "}
                {combinedResult.anomalies.length} baris anomali
              </div>
              <div className="max-h-40 overflow-y-auto space-y-0.5">
                {combinedResult.anomalies.slice(0, 50).map((a, i) => (
                  <div key={i} className="font-mono">
                    {riderNames[a.rider] ?? a.rider} · {a.date}
                    {a.awb ? ` · ${a.awb}` : ""} — {a.detail}
                  </div>
                ))}
              </div>
            </div>
          )}

          {combinedResult.perRider.length > 0 && (
            <div className="flex justify-end mb-2">
              <PageSizeSelect
                pageSize={combinedPager.pageSize}
                setPageSize={combinedPager.setPageSize}
              />
            </div>
          )}
          <div className="rounded-lg border border-border overflow-hidden mb-2">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="p-3">Rider</th>
                  <th className="p-3 text-right">Hari</th>
                  <th className="p-3 text-right">Kiriman</th>
                  <th className="p-3 text-right">Daily Fee</th>
                  <th className="p-3 text-right">Bonus Ontime</th>
                  <th className="p-3 text-right">Per Kiriman</th>
                  <th className="p-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {combinedResult.perRider.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-muted-foreground">
                      Tidak ada hasil.
                    </td>
                  </tr>
                ) : (
                  combinedPager.paged.map((l) => (
                    <Fragment key={l.rider}>
                      <tr className="border-t border-border">
                        <td className="p-3 font-medium">
                          <button
                            onClick={() => setExpandedRider(expandedRider === l.rider ? null : l.rider)}
                            className="flex items-center gap-1.5 text-left hover:text-primary"
                          >
                            <ChevronRight
                              className={`w-3.5 h-3.5 flex-shrink-0 transition-transform ${expandedRider === l.rider ? "rotate-90" : ""}`}
                            />
                            {riderNames[l.rider] ?? l.rider}
                          </button>
                        </td>
                        <td className="p-3 text-right text-muted-foreground">{l.daysWorked}</td>
                        <td className="p-3 text-right text-muted-foreground">{l.units}</td>
                        <td className="p-3 text-right">{formatRupiah(l.daily_base)}</td>
                        <td className="p-3 text-right">
                          {l.ontime_bonus ? formatRupiah(l.ontime_bonus) : "—"}
                        </td>
                        <td className="p-3 text-right">{formatRupiah(l.per_order)}</td>
                        <td className="p-3 text-right font-semibold">{formatRupiah(l.total)}</td>
                      </tr>
                      {expandedRider === l.rider && (
                        <tr className="bg-muted/30">
                          <td colSpan={7} className="px-4 py-3">
                            <RiderFeeDrilldown rows={drilldown[l.rider] ?? []} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {combinedResult.perRider.length > 0 && (
            <div className="mb-4">
              <PaginationBar
                page={combinedPager.page}
                totalPages={combinedPager.totalPages}
                setPage={combinedPager.setPage}
                from={combinedPager.from}
                to={combinedPager.to}
                total={combinedPager.total}
              />
            </div>
          )}

          <CommitPanel
            ranScheme={ranScheme}
            committing={committing}
            onCommit={commit}
            onCommitInvoice={commitInvoice}
            riderMessage={
              <>
                Cek dulu angkanya di atas. Kalau udah bener, <strong>Commit</strong> untuk simpan
                fee ke data pengiriman — angka ini yang dipungut <strong>Payroll Run</strong>.
              </>
            }
            clientMessage={
              <>
                Skema ini <strong>Client (revenue)</strong>. Commit untuk simpan sebagai invoice.
              </>
            }
          />
        </>
      )}

      {attResult && ranScheme && (
        <>
          {/* Ringkasan Attendance */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <SummaryCard label="Baris absensi" value={String(attResult.totalRows)} />
            <SummaryCard label="Baris absen (fee 0)" value={String(attResult.absentRows)} />
            <SummaryCard label="Subtotal" value={formatRupiah(attResult.subtotal)} />
            <SummaryCard
              label={ranScheme.scheme_for === "client" ? "Total Tagihan" : "Total Fee Attendance"}
              value={formatRupiah(attResult.grandTotal)}
              highlight
            />
          </div>
          {attResult.billing && (
            <div className="rounded-md border border-border bg-card px-4 py-3 mb-4 text-sm space-y-1">
              <Line label="Subtotal" value={formatRupiah(attResult.subtotal)} />
              {attResult.billing.floored && <Line label="→ dinaikkan ke Min Charge" value="" muted />}
              <Line label="+ Admin Fee" value={formatRupiah(attResult.billing.admin_fee)} />
              <Line label="+ PPN" value={formatRupiah(attResult.billing.ppn)} />
              <div className="border-t border-border mt-2 pt-2">
                <Line label="Total Tagihan" value={formatRupiah(attResult.billing.final)} bold />
              </div>
            </div>
          )}

          {attResult.warnings.length > 0 && (
            <div className="rounded-md border-[3px] border-border-strong bg-warning shadow-[6px_6px_0_0_var(--color-border-strong)] px-3.5 py-2.5 mb-4 flex items-start gap-2.5 text-xs text-warning-foreground">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <div>
                {attResult.warnings.map((w, i) => (
                  <div key={i}>{w}</div>
                ))}
              </div>
            </div>
          )}

          {/* Rincian per rider */}
          {attResult.perRider.length > 0 && (
            <div className="flex justify-end mb-2">
              <PageSizeSelect pageSize={attPager.pageSize} setPageSize={attPager.setPageSize} />
            </div>
          )}
          <div className="rounded-lg border border-border overflow-hidden mb-2">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="p-3">Rider</th>
                  <th className="p-3 text-right">Hari Kerja</th>
                  <th className="p-3 text-right">Base</th>
                  <th className="p-3 text-right">Lembur</th>
                  <th className="p-3 text-right">Insentif</th>
                  {attResult.perRider.some((l) => l.delivery_component > 0) && (
                    <th className="p-3 text-right">Per Kiriman</th>
                  )}
                  <th className="p-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {attResult.perRider.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-muted-foreground">
                      Tidak ada hasil.
                    </td>
                  </tr>
                ) : (
                  attPager.paged.map((l) => {
                    const hasDelivComp = attResult.perRider.some((x) => x.delivery_component > 0);
                    const colCount = hasDelivComp ? 7 : 6;
                    return (
                      <Fragment key={l.rider}>
                        <tr className="border-t border-border">
                          <td className="p-3 font-medium">
                            <button
                              onClick={() => setExpandedRider(expandedRider === l.rider ? null : l.rider)}
                              className="flex items-center gap-1.5 text-left hover:text-primary"
                            >
                              <ChevronRight
                                className={`w-3.5 h-3.5 flex-shrink-0 transition-transform ${expandedRider === l.rider ? "rotate-90" : ""}`}
                              />
                              {riderNames[l.rider] ?? l.rider}
                            </button>
                          </td>
                          <td className="p-3 text-right text-muted-foreground">{l.daysWorked}</td>
                          <td className="p-3 text-right">{formatRupiah(l.base)}</td>
                          <td className="p-3 text-right">
                            {l.overtime ? formatRupiah(l.overtime) : "—"}
                          </td>
                          <td className="p-3 text-right">
                            {l.incentive ? formatRupiah(l.incentive) : "—"}
                          </td>
                          {hasDelivComp && (
                            <td className="p-3 text-right">
                              {l.delivery_component ? formatRupiah(l.delivery_component) : "—"}
                            </td>
                          )}
                          <td className="p-3 text-right font-semibold">{formatRupiah(l.total)}</td>
                        </tr>
                        {expandedRider === l.rider && (
                          <tr className="bg-muted/30">
                            <td colSpan={colCount} className="px-4 py-3">
                              <RiderFeeDrilldown rows={drilldown[l.rider] ?? []} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          {attResult.perRider.length > 0 && (
            <div className="mb-4">
              <PaginationBar
                page={attPager.page}
                totalPages={attPager.totalPages}
                setPage={attPager.setPage}
                from={attPager.from}
                to={attPager.to}
                total={attPager.total}
              />
            </div>
          )}

          {/* Commit */}
          <CommitPanel
            ranScheme={ranScheme}
            committing={committing}
            onCommit={commit}
            onCommitInvoice={commitInvoice}
            riderMessage={
              <>
                Cek dulu angkanya di atas. Kalau udah bener, <strong>Commit</strong> untuk simpan
                fee ke data absensi — angka ini yang dipungut <strong>Payroll Run</strong>.
              </>
            }
            clientMessage={
              <>
                Skema ini <strong>Client (revenue)</strong>. Cek dulu angkanya di atas, lalu{" "}
                <strong>Commit</strong> untuk simpan sebagai invoice periode ini — bisa dilihat &
                di-export di halaman <strong>Invoices</strong>.
              </>
            }
          />
        </>
      )}
    </AdminLayout>
  );
}

// Panel "Commit ke Payroll/Invoice" — sama persis strukturnya di ketiga hasil
// (delivery/hybrid/attendance), cuma teks penjelasannya beda tipis per kategori
// (makanya diterima sebagai prop, bukan di-hardcode, biar teks yang tampil ke
// user gak berubah dikit pun dibanding sebelum digabung).
function CommitPanel({
  ranScheme,
  committing,
  onCommit,
  onCommitInvoice,
  riderMessage,
  clientMessage,
}: {
  ranScheme: PricingScheme;
  committing: boolean;
  onCommit: () => void;
  onCommitInvoice: () => void;
  riderMessage: ReactNode;
  clientMessage: ReactNode;
}) {
  const isRider = ranScheme.scheme_for === "rider";
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card px-4 py-3">
      <div className="flex items-start gap-2 text-xs text-muted-foreground">
        <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <span>{isRider ? riderMessage : clientMessage}</span>
      </div>
      <button
        onClick={isRider ? onCommit : onCommitInvoice}
        disabled={committing}
        className="inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
      >
        {committing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        {committing ? "Menyimpan…" : isRider ? "Commit ke Payroll" : "Commit ke Invoice"}
      </button>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="admin-kpi-card p-4" data-variant={highlight ? "primary" : "default"}>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="admin-metric-value text-[22px] font-bold mt-1">{value}</div>
    </div>
  );
}

function Line({
  label,
  value,
  bold,
  muted,
}: {
  label: string;
  value: string;
  bold?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={`flex justify-between ${bold ? "font-semibold" : ""} ${muted ? "text-muted-foreground text-xs" : ""}`}
    >
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
