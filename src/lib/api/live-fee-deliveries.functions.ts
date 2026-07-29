import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { DeliveryRow } from "@/lib/pricing-calc";

// Sumber data LIVE untuk "Hitung Fee" — tarik pengiriman langsung dari mgmt API
// dashelectric (bukan dari delivery_records yang harus di-upload dulu), lalu
// map ke bentuk DeliveryRow yang dipakai engine pricing-calc.
//
//   client "Hitung" (Chief Groom) ──requireSupabaseAuth──▶ fetch mgmt API
//        │  (Authorization user di-attach attachSupabaseAuth global)         │
//        ▼                                                                   │
//   DeliveryRow[]  ◀── filter businessUnit(server) + provider.id(client) ────┘
//
// Env: DASH_MGMT_API_TOKEN — token dengan scope /mgmt/v1/deliveries.

const API = "https://api.dashelectric.co/mgmt/v1/deliveries";
const STATUSES =
  "PENDING_PAYMENT,QUEUEING,ALLOCATING,PENDING_PICKUP,PICKING_UP,PREPARING," +
  "PENDING_DELIVERY,IN_DELIVERY,COMPLETED,NOT_VERIFIED,VERIFIED,FAILED," +
  "IN_RETURN,PENDING_RETURN,FAILED_IN_RETURN,ON_HOLD,RETURNED,CANCELLED,DISPOSED";
const PAGE_SIZE = 500;
const MAX_WORKERS = 6;
const MAX_PAGES = 40; // pengaman (~20k baris) — 1 businessUnit/7hari biasanya < 10 halaman
const CREATED_BUFFER_DAYS = 7; // mundur tarikan createdAt biar nangkap order yg dibuat sebelum periode tapi selesai di dalam periode
const RETRIES = 3;
const JKT_OFFSET_MS = 7 * 60 * 60 * 1000; // Asia/Jakarta = UTC+7

type UpstreamRow = Record<string, any>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Verifikasi sesi TANPA bikin Supabase client (createClient butuh WebSocket
// native yang belum ada di Node < 22). Cukup panggil /auth/v1/user via fetch.
async function assertAuth(token: string) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY belum di-set di server");
  const res = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: key, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Sesi tidak valid — coba login ulang.");
}

/** Hari kalender Asia/Jakarta (YYYY-MM-DD) dari ISO timestamp. */
function jktDay(created: string): string {
  if (!created) return "";
  const t = Date.parse(created);
  if (Number.isNaN(t)) return String(created).slice(0, 10);
  return new Date(t + JKT_OFFSET_MS).toISOString().slice(0, 10);
}

async function apiGet(
  token: string,
  businessUnit: string | null,
  start: string,
  endExclusive: string,
  page: number,
): Promise<any> {
  const q = new URLSearchParams({
    status: STATUSES,
    startDate: start,
    endDate: endExclusive,
    search: "",
    page: String(page),
    size: String(PAGE_SIZE),
  });
  // businessUnit difilter server-side (terbukti mempersempit hasil & bikin
  // cepat). Kalau null ("Semua BU"), tarik semua lalu filter provider client-side.
  if (businessUnit) q.set("businessUnit", businessUnit);
  const url = `${API}?${q.toString()}`;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Authorization: token, "X-Client-Time-Zone": "Asia/Jakarta" },
      });
      if (res.ok) return await res.json();
      if (res.status === 401) throw new Error("Token mgmt API ditolak / kadaluarsa (401)");
      if (![408, 429, 500, 502, 503, 504].includes(res.status))
        throw new Error(`mgmt API error ${res.status}`);
      lastErr = new Error(`mgmt API error ${res.status}`);
    } catch (e) {
      if ((e as Error).message.includes("401")) throw e;
      lastErr = e;
    }
    await sleep(600 * (attempt + 1));
  }
  throw lastErr ?? new Error("Gagal memanggil mgmt API");
}

// Superset DeliveryRow — plus field yang dibutuhkan buat insert ke
// delivery_records (Sync ke Database). Tetap assignable ke DeliveryRow, jadi
// engine pricing-calc tetap jalan tanpa perubahan.
export interface LiveDeliveryRow extends DeliveryRow {
  dash_delivery_id: string | null;
  provider_order_id: string | null;
  sender_name: string | null;
  receiver_name: string | null;
  driver_name: string | null;
}

/** Reduksi 1 record upstream ke LiveDeliveryRow (dipakai pricing-calc + sync DB). */
function toDeliveryRow(x: UpstreamRow): LiveDeliveryRow {
  const q = x.quote ?? {};
  const meta = x.metadata ?? {};
  const drv = meta.driver ?? {};
  const courier = x.courier ?? {};
  const dest = q.destination ?? {};
  const svc = q.service ?? {};
  const driverCode = drv.code ?? (drv.id != null ? String(drv.id) : null) ?? courier.phone ?? null;
  const driverName = drv.first_name
    ? `${drv.first_name} ${drv.last_name ?? ""}`.trim()
    : (courier.name ?? null);
  const deliveryId = x.deliveryID ?? null;
  // Berat = jumlah berat semua package (CSV "Total Weight"); di API ada di
  // quote.packages[].weight, BUKAN quote.weight.
  const packages = Array.isArray(q.packages) ? q.packages : [];
  const weightSum = packages.reduce((s: number, p: any) => s + (Number(p?.weight) || 0), 0);
  // Nama pengirim/penerima = outlet (CSV "Sender/Receiver Name") di x.sender/x.recipient.firstName —
  // dipakai buat klasifikasi DELIVERY/RETURN (lihat handler).
  const senderName = (x.sender?.firstName ?? "").trim() || null;
  const receiverName = (x.recipient?.firstName ?? "").trim() || null;
  return {
    id: deliveryId, // id upstream — bukan uuid delivery_records
    rider_id: null, // diresolusi di client (by driver_code)
    driver_code: driverCode,
    // Tanggal patokan = saat status final (CSV "Tanggal Status"), BUKAN createdAt:
    // COMPLETED → completedAt; FAILED → updatedAt (saat ditandai gagal). Pakai ||
    // (bukan ??) biar string kosong "" juga jatuh ke fallback.
    delivery_date: jktDay(x.completedAt || x.updatedAt || x.createdAt || ""),
    awb: deliveryId,
    district: meta.city ?? null,
    distance_km: q.distance != null ? Number(q.distance) / 1000 : null, // API meter → km
    weight_kg: packages.length ? weightSum : (q.weight ?? null),
    destination_address: dest.address ?? null,
    // CSV "Service Type" = quote.service.type (mis. "INSTANT"), bukan .category ("FLEET+").
    service_type: svc.type ?? svc.category ?? x.businessUnit ?? null,
    status: x.status ?? null,
    delivery_type: "DELIVERY", // di-refine jadi RETURN di handler (klasifikasi by hub)
    // extra buat insert delivery_records
    dash_delivery_id: deliveryId,
    provider_order_id: x.providerOrderID ?? x.provider_order_id ?? deliveryId,
    sender_name: senderName,
    receiver_name: receiverName,
    driver_name: driverName,
  };
}

export interface LiveFeeDeliveriesResult {
  rows: LiveDeliveryRow[];
  meta: {
    provider_id: number;
    business_unit: string;
    fetched: number; // total upstream di businessUnit itu (sebelum filter provider)
    matched: number; // setelah filter provider
    from: string;
    to: string;
  };
}

export const loadLiveFeeDeliveries = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      token: z.string().min(1),
      providerId: z.number().int().positive(),
      businessUnit: z.string().nullable().optional(), // null/kosong = semua BU
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal 'dari' tidak valid"),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal 'sampai' tidak valid"),
    }),
  )
  .handler(async ({ data }): Promise<LiveFeeDeliveriesResult> => {
    await assertAuth(data.token);
    if (data.from > data.to) throw new Error("Tanggal 'dari' tidak boleh setelah 'sampai'");

    const raw = (process.env.DASH_MGMT_API_TOKEN || "").replace(/^\s*Bearer\s+/i, "").trim();
    if (!raw)
      throw new Error(
        "DASH_MGMT_API_TOKEN belum di-set di server — isi di .env lalu restart dev server.",
      );
    const token = `Bearer ${raw}`;

    // PENTING: API memfilter startDate/endDate berdasarkan `createdAt` (tanggal
    // order DIBUAT), sedangkan periode payroll pakai tanggal SELESAI (completedAt,
    // = delivery_date). Order bisa dibuat H-1/H-2 lalu selesai di periode.
    // Solusi: tarik window createdAt lebih LEBAR (mundur BUFFER hari), lalu filter
    // hasilnya by delivery_date sesuai [from, to]. Cocok dengan basis file upload.
    const startDt = new Date(data.from + "T00:00:00Z");
    startDt.setUTCDate(startDt.getUTCDate() - CREATED_BUFFER_DAYS);
    const fetchStart = startDt.toISOString().slice(0, 10);
    // UI 'sampai' inklusif; API endDate eksklusif → +1 hari.
    const endDt = new Date(data.to + "T00:00:00Z");
    endDt.setUTCDate(endDt.getUTCDate() + 1);
    const endExclusive = endDt.toISOString().slice(0, 10);

    const bu = data.businessUnit || null;
    const first = await apiGet(token, bu, fetchStart, endExclusive, 1);
    const upstream: UpstreamRow[] = [...(first?.data ?? [])];
    const pg = first?.pagination ?? {};
    const last = Math.min(pg.last_page ?? pg.lastPage ?? 1, MAX_PAGES);

    if (last > 1) {
      const pages: number[] = [];
      for (let p = 2; p <= last; p++) pages.push(p);
      const got: Record<number, UpstreamRow[]> = {};
      let idx = 0;
      const worker = async () => {
        while (idx < pages.length) {
          const p = pages[idx++];
          const d = await apiGet(token, bu, fetchStart, endExclusive, p);
          got[p] = d?.data ?? [];
        }
      };
      await Promise.all(Array.from({ length: Math.min(MAX_WORKERS, pages.length) }, worker));
      for (const p of Object.keys(got).map(Number).sort((a, b) => a - b)) upstream.push(...got[p]);
    }

    const matched = upstream.filter((x) => x.provider?.id === data.providerId);
    const rows = matched.map(toDeliveryRow);

    // Klasifikasi DELIVERY/RETURN — replikasi classifyDeliveryType: hub = nama
    // pengirim (outlet) yang paling sering muncul; baris dari hub = DELIVERY,
    // menuju hub = RETURN. Skema Wicked Pies pasang tarif beda (antar vs kembali).
    const freq = new Map<string, number>();
    for (const r of rows) if (r.sender_name) freq.set(r.sender_name, (freq.get(r.sender_name) ?? 0) + 1);
    let hub: string | null = null;
    let hubCount = 0;
    freq.forEach((c, name) => {
      if (c > hubCount) {
        hub = name;
        hubCount = c;
      }
    });
    if (hub) {
      for (const r of rows) {
        if (r.sender_name === hub) r.delivery_type = "DELIVERY";
        else if (r.receiver_name === hub) r.delivery_type = "RETURN";
        // selain itu biarkan default "DELIVERY"
      }
    }

    // Filter final berdasar tanggal SELESAI (delivery_date = completedAt) sesuai
    // periode yang diminta — bukan createdAt. Ini yang bikin hasil match file upload.
    const inPeriod = rows.filter((r) => r.delivery_date >= data.from && r.delivery_date <= data.to);

    return {
      rows: inPeriod,
      meta: {
        provider_id: data.providerId,
        business_unit: bu ?? "SEMUA",
        fetched: upstream.length,
        matched: inPeriod.length,
        from: data.from,
        to: data.to,
      },
    };
  });
