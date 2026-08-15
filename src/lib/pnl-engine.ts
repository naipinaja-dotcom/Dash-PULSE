// =========================================================
// PnL Engine (murni, tanpa DB/UI) — dipakai bersama oleh halaman
// Margin Analytics (admin.pnl.tsx) & Executive Dashboard.
// Pilih skema rider/client per client, dispatch ke engine yang sesuai
// KATEGORI skema-nya (delivery/attendance/hybrid — sebelumnya SELALU
// calcScheme, jadi client yang skema aktifnya "Per Kehadiran" gak pernah
// kehitung; kalau client itu juga gak punya delivery_records sama sekali
// — mis. Alfagift, murni attendance — dia malah gak pernah MUNCUL di
// perClient sama sekali, karena grouping dulu cuma dari delivery_records).
// =========================================================
import { calcScheme, calcAttendanceScheme, calcHybridScheme, type DeliveryRow, type AttendanceLogRow } from "./pricing-calc";
import type { PricingScheme, SchemeFor } from "./pricing-types";

export type ClientLite = { id: string; name: string };

// attendance_logs gak punya kolom client_id (cuma client_name teks bebas,
// beda dari delivery_records yang punya FK client_id) — jadi client-nya
// di-resolve lewat pencocokan nama ke clients.name di bawah.
export type AttendanceLogWithClientName = AttendanceLogRow & { client_name: string | null };

export interface ClientPnl {
  clientId: string;
  client: string;
  revenue: number | null; // null = belum ada skema client
  cost: number;
  margin: number | null;
  marginPct: number | null;
  deliveryCount: number;
  earliestDelivery: string | null;
  costRows: { date: string; fee: number }[];
  revenueRows: { date: string; fee: number }[];
}

export interface PnlResult {
  perClient: ClientPnl[];
  totRevenue: number;
  totCost: number;
  totMargin: number;
  totMarginPct: number;
}

// skema aktif: harus emang berlaku pas `asOfDate` (effective_from..effective_to),
// lalu yang khusus client itu diutamakan atas "semua client", lalu yang
// effective_from/created_at paling baru menang kalau masih ada dobel.
// `asOfDate` default hari ini (perilaku lama, dipakai dashboard on-demand yang
// emang mau tau skema yang berlaku SEKARANG) — tapi buat laporan periode
// historis (mis. Weekly PNL Push yang di-rerun/backfill), caller WAJIB kirim
// akhir periode laporannya di sini, bukan biarin default ke hari ini. Kalau
// enggak, rerun buat minggu lama bisa kehitung pakai rate yang udah berubah
// sekarang, bukan rate yang beneran berlaku pas minggu itu.
export function pickPricingScheme(
  schemes: PricingScheme[],
  clientId: string,
  kind: SchemeFor,
  asOfDate: string = new Date().toISOString().slice(0, 10),
) {
  const cands = schemes.filter(
    (s) =>
      s.scheme_for === kind &&
      s.params?.version === 1 &&
      (s.client_id === clientId || s.client_id === null) &&
      s.effective_from <= asOfDate &&
      (!s.effective_to || s.effective_to >= asOfDate)
  );
  return cands.sort((a, b) => {
    const aSpecific = a.client_id === clientId;
    const bSpecific = b.client_id === clientId;
    if (aSpecific !== bSpecific) return aSpecific ? -1 : 1;
    if (a.effective_from !== b.effective_from) return a.effective_from > b.effective_from ? -1 : 1;
    return a.created_at > b.created_at ? -1 : 1;
  })[0];
}

const normName = (s: string | null | undefined) => String(s ?? "").trim().toLowerCase();

// Dispatch ke engine yang sesuai kategori skema — inilah fix-nya: sebelumnya
// SELALU calcScheme (engine delivery), yang balikin subtotal 0 buat
// env.type "attendance"/"combined" (calcScheme gak punya case buat itu,
// jatuh ke default array-of-0). grandTotal dipakai (bukan subtotal) karena
// sekarang billing_addons diterapin di ketiga engine (lihat pricing-calc.ts).
function calcForScheme(
  scheme: PricingScheme | undefined,
  crows: DeliveryRow[],
  cattendance: AttendanceLogWithClientName[],
): { grandTotal: number; perRow: { date: string; fee: number }[] } | null {
  if (!scheme) return null;
  if (scheme.category === "attendance") {
    const r = calcAttendanceScheme(scheme.params, cattendance, crows);
    return { grandTotal: r.grandTotal, perRow: r.perRow.map((x) => ({ date: x.date, fee: x.fee })) };
  }
  if (scheme.category === "hybrid") {
    const r = calcHybridScheme(scheme.params, crows, cattendance);
    return { grandTotal: r.grandTotal, perRow: r.perRow.map((x) => ({ date: x.date, fee: x.fee })) };
  }
  const r = calcScheme(scheme.params, crows);
  return { grandTotal: r.grandTotal, perRow: r.perRow.map((x) => ({ date: x.date, fee: x.fee })) };
}

export function computePnl(
  rows: (DeliveryRow & { client_id: string | null })[],
  schemes: PricingScheme[],
  clients: ClientLite[],
  attendanceRows: AttendanceLogWithClientName[] = [],
  // Biaya molis yang charge_target='client_revenue' (lihat molis-cost.ts) —
  // rider gratis, tapi ini tetap ngurangin margin client-nya di sini.
  molisCostByClient: Map<string, number> = new Map(),
  // Skema yang dipakai adalah skema yang berlaku pas tanggal ini (lihat
  // pickPricingScheme) — default hari ini, TAPI caller yang ngitung periode
  // historis (mis. Weekly PNL Push) wajib kirim akhir periode laporannya.
  asOfDate?: string,
): PnlResult {
  const byClient = new Map<string, DeliveryRow[]>();
  for (const r of rows) {
    const cid = r.client_id ?? "(tanpa client)";
    (byClient.get(cid) ?? byClient.set(cid, []).get(cid)!).push(r);
  }

  const clientIdByName = new Map(clients.map((c) => [normName(c.name), c.id]));
  const attByClient = new Map<string, AttendanceLogWithClientName[]>();
  for (const r of attendanceRows) {
    const cid = clientIdByName.get(normName(r.client_name)) ?? "(tanpa client)";
    (attByClient.get(cid) ?? attByClient.set(cid, []).get(cid)!).push(r);
  }

  // Union client dari 2 sumber — client yang MURNI attendance (nol
  // delivery_records, mis. Alfagift) sebelumnya gak pernah masuk sini sama
  // sekali karena cuma delivery_records yang di-grouping.
  const allClientIds = new Set([...byClient.keys(), ...attByClient.keys(), ...molisCostByClient.keys()]);

  const nameOf = new Map(clients.map((c) => [c.id, c.name]));
  const perClient: ClientPnl[] = [];
  for (const cid of allClientIds) {
    const crows = byClient.get(cid) ?? [];
    const cattendance = attByClient.get(cid) ?? [];
    const riderS = pickPricingScheme(schemes, cid, "rider", asOfDate);
    const clientS = pickPricingScheme(schemes, cid, "client", asOfDate);
    const costResult = calcForScheme(riderS, crows, cattendance);
    const revResult = calcForScheme(clientS, crows, cattendance);
    const cost = (costResult?.grandTotal ?? 0) + (molisCostByClient.get(cid) ?? 0);
    const revenue = revResult ? revResult.grandTotal : null;
    const margin = revenue === null ? null : revenue - cost;
    const marginPct = revenue && revenue > 0 && margin !== null ? (margin / revenue) * 100 : null;
    const dates = crows.map((r) => r.delivery_date).filter(Boolean).sort();
    perClient.push({
      clientId: cid,
      client: nameOf.get(cid) ?? "(tanpa client)",
      revenue,
      cost,
      margin,
      marginPct,
      deliveryCount: crows.length,
      earliestDelivery: dates[0] ?? null,
      costRows: costResult?.perRow ?? [],
      revenueRows: revResult?.perRow ?? [],
    });
  }
  perClient.sort((a, b) => (b.margin ?? -Infinity) - (a.margin ?? -Infinity));

  const totRevenue = perClient.reduce((s, r) => s + (r.revenue ?? 0), 0);
  const totCost = perClient.reduce((s, r) => s + r.cost, 0);
  const totMargin = totRevenue - totCost;
  const totMarginPct = totRevenue > 0 ? (totMargin / totRevenue) * 100 : 0;

  return { perClient, totRevenue, totCost, totMargin, totMarginPct };
}

export type TrendGranularity = "daily" | "weekly" | "monthly";

export interface TrendPoint {
  bucket: string; // label tampil
  sortKey: string; // dipakai sort chronological
  revenue: number;
  cost: number;
  margin: number;
  marginPct: number;
}

function bucketKey(date: string, granularity: TrendGranularity): { sortKey: string; label: string } {
  const d = new Date(date + "T00:00:00");
  if (granularity === "daily") return { sortKey: date, label: d.toLocaleDateString("id-ID", { day: "2-digit", month: "short" }) };
  if (granularity === "monthly") {
    const key = date.slice(0, 7);
    return { sortKey: key, label: d.toLocaleDateString("id-ID", { month: "short", year: "2-digit" }) };
  }
  // weekly: kunci = Senin minggu itu
  const day = (d.getDay() + 6) % 7; // Senin=0
  const monday = new Date(d);
  monday.setDate(d.getDate() - day);
  const key = monday.toISOString().slice(0, 10);
  return { sortKey: key, label: monday.toLocaleDateString("id-ID", { day: "2-digit", month: "short" }) };
}

// Rangkai trend BCR (margin %) dari seluruh perRow cost+revenue semua client, dikelompokkan per bucket waktu.
export function buildTrend(perClient: ClientPnl[], granularity: TrendGranularity): TrendPoint[] {
  const buckets = new Map<string, { label: string; revenue: number; cost: number }>();
  const add = (date: string, field: "revenue" | "cost", amount: number) => {
    const { sortKey, label } = bucketKey(date, granularity);
    const b = buckets.get(sortKey) ?? { label, revenue: 0, cost: 0 };
    b[field] += amount;
    buckets.set(sortKey, b);
  };
  for (const c of perClient) {
    for (const rf of c.costRows) add(rf.date, "cost", rf.fee);
    for (const rf of c.revenueRows) add(rf.date, "revenue", rf.fee);
  }
  return Array.from(buckets.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([sortKey, b]) => ({
      bucket: b.label,
      sortKey,
      revenue: b.revenue,
      cost: b.cost,
      margin: b.revenue - b.cost,
      marginPct: b.revenue > 0 ? ((b.revenue - b.cost) / b.revenue) * 100 : 0,
    }));
}
