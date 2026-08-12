// =========================================================
// Calculator Engine (otak hitungan) — MURNI, tanpa DB/UI.
// Dikasih 1 skema (PricingEnvelope) + baris pengiriman → keluar:
//  - fee PER BARIS (buat disimpan ke delivery_records.fee → dipakai Payroll)
//  - rekap PER RIDER (buat preview)
// Bisa dites terpisah dengan data contoh.
// =========================================================
import type { PricingEnvelope, StepTier, RangeRow, RangeDimensionConfig, ModularDeliveryConfig } from "./pricing-types";

// Bentuk baris data pengiriman (mengikuti tabel delivery_records)
export interface DeliveryRow {
  id?: string | null;
  rider_id?: string | null;
  driver_code?: string | null;
  delivery_date: string; // YYYY-MM-DD
  awb?: string | null;
  district?: string | null;
  distance_km?: number | null;
  weight_kg?: number | null;
  destination_address?: string | null;
  service_type?: string | null;
  status?: string | null;
  delivery_type?: string | null; // "DELIVERY" | "RETURN" | null (belum ke-klasifikasi)
}

export interface RowFee {
  id?: string | null;
  rider: string;
  date: string;
  base: number;
  add_kg: number;
  multi_drop: number;
  fee: number; // base + add_kg + multi_drop
}

export interface RiderLine {
  rider: string;
  units: number;
  base: number;
  add_kg: number;
  multi_drop: number;
  total: number;
}

export interface RowAnomaly {
  rider: string;
  date: string;
  awb?: string | null;
  kind: "zero_distance_paid" | "missing_weight" | "zero_fee";
  detail: string;
}

// Rekap baris yang DI-SKIP (status bukan COMPLETED), dikelompokkan per rider —
// bukan data/aturan baru: ini isi "tumpukan buangan" yang selama ini cuma
// ditampilkan jumlahnya. Buat jawab "kok rider X ga muncul?" dengan bukti.
export interface SkippedRiderLine {
  rider: string;
  count: number;
  statuses: Record<string, number>; // mis. { PENDING_PICKUP: 5, FAILED: 1 }
}

// Kelompokkan baris yang di-skip (status bukan COMPLETED) per rider —
// transparansi, bukan aturan baru. Dipakai calcScheme & calcHybridScheme.
function buildSkippedPerRider<T extends { status?: string | null }>(
  rows: T[],
  keyOf: (r: T) => string,
): SkippedRiderLine[] {
  const skipMap = new Map<string, SkippedRiderLine>();
  for (const r of rows) {
    if (isCompleted(r)) continue;
    const k = keyOf(r);
    const line = skipMap.get(k) ?? { rider: k, count: 0, statuses: {} };
    line.count++;
    const st = String(r.status ?? "").trim().toUpperCase() || "(KOSONG)";
    line.statuses[st] = (line.statuses[st] ?? 0) + 1;
    skipMap.set(k, line);
  }
  return [...skipMap.values()].sort((a, b) => b.count - a.count);
}

export interface CalcResult {
  perRow: RowFee[]; // 1 entri per baris COMPLETED (buat commit ke DB)
  perRider: RiderLine[];
  subtotal: number;
  billing?: { floored: boolean; admin_fee: number; management_fee: number; ppn: number; final: number };
  grandTotal: number;
  completedRows: number;
  skippedRows: number;
  skippedPerRider: SkippedRiderLine[];
  warnings: string[];
  anomalies: RowAnomaly[]; // ga bikin gagal komputasi, cuma diflag buat dicek manual
}

// Billing add-ons (min charge → +admin fee → ×(1+PPN%)) berlaku di level
// INVOICE, jadi harus sama di ketiga engine (delivery/attendance/hybrid) —
// bukan cuma calcScheme. Sebelumnya calcAttendanceScheme & calcHybridScheme
// gak pernah nerapin ini sama sekali walau form-nya ngasih toggle Billing
// Add-ons buat scheme_for="client" di kategori manapun.
function applyBillingAddons(
  subtotal: number,
  billingAddons: PricingEnvelope["billing_addons"],
): { billing?: CalcResult["billing"]; grandTotal: number } {
  if (!billingAddons) return { grandTotal: subtotal };
  let amt = subtotal;
  const floored = amt < (Number(billingAddons.min_charge) || 0);
  if (floored) amt = Number(billingAddons.min_charge) || 0;
  // Management fee = persen dari operational (amt setelah min_charge). Client
  // yang gak kena → persen 0 → management 0, perilaku sama seperti sebelum ada
  // fitur ini (backward compatible).
  const management = amt * ((Number(billingAddons.management_fee_percent) || 0) / 100);
  const admin = Number(billingAddons.admin_fee_flat) || 0;
  const beforeTax = amt + management + admin;
  const ppn = beforeTax * ((Number(billingAddons.ppn_percent) || 0) / 100);
  const grandTotal = beforeTax + ppn;
  return { billing: { floored, admin_fee: admin, management_fee: management, ppn, final: grandTotal }, grandTotal };
}

// ---------------- helpers ----------------
const norm = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const riderKey = (r: { rider_id?: string | null; driver_code?: string | null }) => r.rider_id || r.driver_code || "(tanpa rider)";
export const isCompleted = (r: { status?: string | null }) => norm(r.status) === "completed";

// Override tarif per-area ditulis manual pakai prefix administratif ("Kota
// Jakarta Pusat", "Kabupaten Tangerang"), tapi district hasil reverse-geocode
// (lihat admin.upload.tsx) balikin nama polos ("Jakarta Pusat", "Tangerang")
// — OSM/ORS gak nyimpen prefix "Kota"/"Kabupaten" di level itu. Exact match
// dicoba DULU (gak ubah matching yang udah kepake sekarang, termasuk yang
// kebetulan district-nya nyimpen nama toko/outlet, bukan area asli), baru
// kalau gak ketemu, coba lagi setelah prefix dibuang dari dua-duanya.
const stripAreaPrefix = (s: string) => s.replace(/^(kota|kabupaten)\s+/, "");
const normArea = (s: unknown) => stripAreaPrefix(norm(s));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findByKey(items: any[], value: string): any {
  const exact = items.find((x: { key: string }) => norm(x.key) === norm(value));
  if (exact) return exact;
  // Skema yang punya "Kota X" DAN "Kabupaten X" sekaligus (dua area beda,
  // biasanya tarif beda juga) sama-sama luntur ke "x" begitu prefix dibuang
  // — nama polos hasil geocode gak ngasih tau area yang mana yang benar.
  // Kalau fallback ini nemu LEBIH DARI SATU kandidat, itu ambigu: mending
  // dianggap gak match sama sekali (jatuh ke base_fee default band) daripada
  // asal pilih kandidat pertama dan kasih tarif area yang salah.
  const candidates = items.filter((x: { key: string }) => normArea(x.key) === normArea(value));
  return candidates.length === 1 ? candidates[0] : undefined;
}

function resolveField(row: DeliveryRow, columnName: string): string {
  const c = norm(columnName);
  if (c.includes("service") || c.includes("layanan")) return String(row.service_type ?? "");
  if (c.includes("return") || c.includes("delivery type") || c.includes("tipe kirim")) return String(row.delivery_type ?? "");
  return String(row.district ?? "");
}

// Beberapa skema pakai rate_by="delivery_type" tapi rates-nya CAMPUR: key
// "RETURN" (flat) + nama-nama district (buat DELIVERY biasa, per-area) —
// match_column="Area" ada di config tapi diabaikan selama rate_by masih
// "delivery_type". Coba match delivery_type dulu (biasanya cuma nemu pas
// baris RETURN), baru fallback ke district kalau row-nya DELIVERY biasa yang
// mestinya kena tarif per-area. Skema yang murni delivery_type-only (rates
// cuma berisi DELIVERY/RETURN, gak ada nama area) gak kepengaruh — fallback
// district cuma jalan kalau match delivery_type gagal duluan.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolveRateHit(row: DeliveryRow, rateSettings: { rate_by: string; match_column: string; rates: any[] }) {
  if (rateSettings.rate_by === "delivery_type") {
    return (
      findByKey(rateSettings.rates, resolveField(row, "delivery type")) ??
      findByKey(rateSettings.rates, String(row.district ?? ""))
    );
  }
  return findByKey(rateSettings.rates, resolveField(row, rateSettings.match_column));
}

export function stepTierFee(tier: StepTier | null | undefined, value: number): number {
  if (!tier) return 0;
  let fee = tier.base_fee || 0;
  const v = Number(value) || 0;
  for (const t of tier.tiers || []) {
    const lo = Number(t.from) || 0;
    const hi = t.to === null || t.to === undefined ? Infinity : Number(t.to);
    if (v > lo) {
      const span = Math.min(v, hi) - lo;
      const step = Number(t.step) || 1;
      fee += Math.ceil(span / step) * (Number(t.add_per_step) || 0);
    }
  }
  return fee;
}

function groupBy<T>(arr: T[], keyFn: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of arr) {
    const k = keyFn(x);
    const g = m.get(k);
    if (g) g.push(x);
    else m.set(k, [x]);
  }
  return m;
}

// Bagi `total` (rupiah bulat) ke beberapa baris sesuai bobot, hasilnya PAS
// (jumlah alokasi == total). Sisa recehan ditaruh ke baris berbobot terbesar.
function allocInt(total: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const T = Math.round(total);
  const w = weights.map((x) => Math.max(0, Number(x) || 0));
  const sumW = w.reduce((a, b) => a + b, 0);
  const raw = sumW > 0 ? w.map((x) => (x / sumW) * T) : w.map(() => T / n);
  const floors = raw.map((x) => Math.floor(x));
  let rem = T - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < rem && k < n; k++) floors[order[k].i]++;
  return floors;
}

// ---------------- pure components (Kategori 1 — Per Pengiriman) ----------------
// Terima baris (index-aligned dengan output), kembaliin FEE PER BARIS.
// Murni: tanpa skip/anomaly/modifier logic — itu tetap tanggung jawab
// wrapper (calcScheme).

// "unit_basis"/"unit" === "unique_address": 1 alamat unik per rider per hari
// cuma dihitung sekali (kunjungan ke-2+ ke alamat sama gak dapet tarif lagi,
// mis. multi-drop toko yang sama). Dipakai calcFlatComponent (mesin lama,
// calc_type="flat_unit") DAN calcModularDeliveryComponent (jalur flat murni)
// — satu tempat biar dua-duanya konsisten.
function billableByUniqueAddress(rows: DeliveryRow[]): Set<DeliveryRow> {
  const billable = new Set<DeliveryRow>();
  const byRider = groupBy(rows, riderKey);
  for (const [, rrows] of byRider) {
    const seen = new Set<string>();
    for (const r of rrows) {
      const key = r.delivery_date + "|" + norm(r.destination_address);
      if (seen.has(key)) continue;
      seen.add(key);
      billable.add(r);
    }
  }
  return billable;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function calcFlatComponent(rows: DeliveryRow[], cfg: any): number[] {
  const out = new Array(rows.length).fill(0);
  const billable = cfg.unit === "unique_address" ? billableByUniqueAddress(rows) : null;
  rows.forEach((r, i) => {
    if (billable && !billable.has(r)) return;
    if (cfg.rate_by === "flat") {
      out[i] = Number(cfg.flat_rate) || 0;
      return;
    }
    const hit = findByKey(cfg.rates || [], resolveField(r, cfg.match_column));
    out[i] = hit ? Number(hit.rate) || 0 : Number(cfg.default_rate) || 0;
  });
  return out;
}

// `accumulate: "per_order"` = tarif tier dihitung per baris (dulunya `tier`).
// `accumulate: "daily"` = jarak/berat 1 rider 1 hari dijumlah dulu, baru
// dihitung tarifnya lalu dialokasikan ke tiap baris hari itu (dulunya `tier_daily`).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function calcTierComponent(rows: DeliveryRow[], cfg: any, accumulate: "daily" | "per_order" = "per_order"): number[] {
  const out = new Array(rows.length).fill(0);
  const idxOf = new Map<DeliveryRow, number>();
  rows.forEach((r, i) => idxOf.set(r, i));

  if (accumulate === "per_order") {
    rows.forEach((r) => {
      const d = cfg.distance ? stepTierFee(cfg.distance, r.distance_km ?? 0) : 0;
      const w = cfg.weight ? stepTierFee(cfg.weight, r.weight_kg ?? 0) : 0;
      out[idxOf.get(r)!] = d + w;
    });
    return out;
  }

  const byRider = groupBy(rows, riderKey);
  for (const [, rrows] of byRider) {
    const byDay = groupBy(rrows, (r) => r.delivery_date);
    for (const [, drows] of byDay) {
      const sumKm = drows.reduce((s, r) => s + (Number(r.distance_km) || 0), 0);
      const sumKg = drows.reduce((s, r) => s + (Number(r.weight_kg) || 0), 0);
      const distFee = cfg.distance ? stepTierFee(cfg.distance, sumKm) : 0;
      const weightFee = cfg.weight ? stepTierFee(cfg.weight, sumKg) : 0;
      // Distance & Weight dialokasikan TERPISAH, masing-masing proporsional ke
      // dimensinya sendiri, baru dijumlah per baris — bukan 1 vector bobot
      // gabungan. Sebelumnya kalau Distance+Weight dua-duanya aktif, bobot
      // alokasi cuma pakai jarak (weight diabaikan total buat nentuin porsi
      // tiap baris) — total harian rider tetap benar, tapi fee PER BARIS
      // (delivery_records.fee) salah alokasi, bikin laporan per-order gak akurat.
      const distParts = cfg.distance
        ? allocInt(distFee, drows.map((r) => Number(r.distance_km) || 0))
        : drows.map(() => 0);
      const weightParts = cfg.weight
        ? allocInt(weightFee, drows.map((r) => Number(r.weight_kg) || 0))
        : drows.map(() => 0);
      drows.forEach((r, i) => (out[idxOf.get(r)!] = distParts[i] + weightParts[i]));
    }
  }
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function calcThresholdComponent(rows: DeliveryRow[], cfg: any): number[] {
  const out = new Array(rows.length).fill(0);
  const idxOf = new Map<DeliveryRow, number>();
  rows.forEach((r, i) => idxOf.set(r, i));

  const byRider = groupBy(rows, riderKey);
  for (const [, rrows] of byRider) {
    const byStoreDay = groupBy(rrows, (r) => resolveField(r, cfg.group_by) + "||" + r.delivery_date);
    for (const [, grp] of byStoreDay) {
      const storeVal = resolveField(grp[0], cfg.group_by);
      const rule = findByKey(cfg.rules || [], storeVal);
      const threshold = Number(rule?.threshold ?? cfg.default?.threshold) || 0;
      const rate = Number(rule?.rate ?? cfg.default?.rate) || 0;
      const totalKg = grp.reduce((s, r) => s + (Number(r.weight_kg) || 0), 0);
      const grpFee = threshold > 0 ? Math.ceil(totalKg / threshold) * rate : 0;
      const parts = allocInt(grpFee, grp.map((r) => Number(r.weight_kg) || 0));
      grp.forEach((r, i) => (out[idxOf.get(r)!] = parts[i]));
    }
  }
  return out;
}

// ---------------- Modular v2 (Distance/Weight, band-independent lookup) ----------------
// Beda dari `stepTierFee` (yang cumulative, akumulasi lewat semua band dari
// bawah): di sini value dicari masuk band [from,to) MANA, lalu dihitung
// base_fee (+ step kalau tipe "tier") BAND ITU SAJA — band lain diabaikan
// total. Cocok buat rate-card ala kurir (tiap zona jarak punya tarif
// sendiri, bukan akumulasi).
export function bandLookupFee(rows: RangeRow[], value: number): { fee: number; band: RangeRow | null } {
  const v = Number(value) || 0;
  for (const band of rows) {
    const lo = Number(band.from) || 0;
    const hi = band.to === null || band.to === undefined ? Infinity : Number(band.to);
    if (v >= lo && v < hi) {
      if (band.type === "flat") return { fee: Number(band.base_fee) || 0, band };
      const step = Number(band.step) || 1;
      const addPerStep = Number(band.add_per_step) || 0;
      const span = v - lo;
      return { fee: (Number(band.base_fee) || 0) + Math.ceil(span / step) * addPerStep, band };
    }
  }
  return { fee: 0, band: null };
}

export function calcRangeComponent(
  rows: DeliveryRow[],
  dimCfg: RangeDimensionConfig,
  valueOf: (r: DeliveryRow) => number,
): number[] {
  const out = new Array(rows.length).fill(0);
  const idxOf = new Map<DeliveryRow, number>();
  rows.forEach((r, i) => idxOf.set(r, i));

  if (dimCfg.accumulate === "per_order") {
    rows.forEach((r) => {
      const { fee } = bandLookupFee(dimCfg.rows, valueOf(r));
      out[idxOf.get(r)!] = fee;
    });
    return out;
  }

  // accumulate === "daily": jumlahin value (km/kg) 1 rider 1 hari dulu, band
  // lookup SEKALI buat hari itu, baru dialokasikan proporsional ke tiap baris
  // (rate-per-kolom override tidak berlaku di mode ini — nilainya udah gabungan).
  const byRider = groupBy(rows, riderKey);
  for (const [, rrows] of byRider) {
    const byDay = groupBy(rrows, (r) => r.delivery_date);
    for (const [, drows] of byDay) {
      const sumVal = drows.reduce((s, r) => s + (valueOf(r) || 0), 0);
      const { fee: dayFee } = bandLookupFee(dimCfg.rows, sumVal);
      const weights = drows.map((r) => valueOf(r) || 0);
      const parts = allocInt(dayFee, weights);
      drows.forEach((r, i) => (out[idxOf.get(r)!] = parts[i]));
    }
  }
  return out;
}

/** Gabungan Distance + Weight (sum) — pengganti calcFlatComponent/calcTierComponent/
 * calcThresholdComponent untuk skema baru (`env.type === "modular_v2"`). Skema lama
 * tetap dihitung lewat 3 fungsi component di atas, tidak disentuh. */
export function calcModularDeliveryComponent(
  rows: DeliveryRow[],
  cfg: ModularDeliveryConfig,
  stats?: { unmatchedArea: number },
): number[] {
  const out = new Array(rows.length).fill(0);
  const rateSettings = { rate_by: cfg.rate_by, match_column: cfg.match_column, rates: cfg.rates ?? [] };

  // rate_by="column"/"delivery_type" itu override PER BARIS (mis. Return flat
  // Rp12rb) yang GANTIIN total fee modular baris itu (distance+weight
  // gabungan) — bukan nilai tambahan per-dimensi. Dihitung SEKALI di sini dan
  // dipakai cuma sekali oleh dimensi per_order pertama yang nyentuh baris itu.
  // Dulu override ini dihitung ulang di dalam tiap panggilan calcRangeComponent
  // per dimensi, jadi kalau distance & weight dua-duanya aktif, baris yang
  // ke-override di KEDUA dimensi (mis. Return <5km DAN <20kg, dua-duanya jatuh
  // ke band flat) ke-tambah 2× (bug: Wicked Pies Return dobel-charge). Override
  // juga cuma berlaku dulu kalau band yang ke-hit tipenya "flat" — baris yang
  // jatuh ke band "tier" (mis. Return jauh/berat) lolos dari override dan
  // malah kena rumus per-km/per-kg delivery biasa. accumulate="daily" TETAP
  // gak kepake override-nya (nilai udah gabungan banyak baris, gak valid
  // dipaksa jadi 1 angka per baris).
  const rowOverride: (number | null)[] =
    rateSettings.rate_by === "flat"
      ? rows.map(() => null)
      : rows.map((r) => {
          const hit = resolveRateHit(r, rateSettings);
          return hit ? Number(hit.rate) || 0 : null;
        });
  const overrideUsed = new Array(rows.length).fill(false);
  const applyDim = (dimCfg: RangeDimensionConfig, valueOf: (r: DeliveryRow) => number, target: number[]) => {
    calcRangeComponent(rows, dimCfg, valueOf).forEach((f, i) => {
      if (dimCfg.accumulate === "per_order" && rowOverride[i] != null) {
        if (!overrideUsed[i]) {
          target[i] += rowOverride[i]!;
          overrideUsed[i] = true;
        }
        return;
      }
      target[i] += f;
    });
  };

  if (cfg.distance?.enabled) {
    const distanceOut = new Array(rows.length).fill(0);
    applyDim(cfg.distance, (r) => Number(r.distance_km) || 0, distanceOut);
    // Berat lewat batas -> fee Distance baris itu dikali N (Weight, kalau
    // aktif, tetap dihitung normal terpisah di bawah — berat di sini cuma
    // pemicu, bukan komponen yang ikut kena kali).
    const ws = cfg.weight_surcharge;
    if (ws?.enabled) {
      rows.forEach((r, i) => {
        if ((Number(r.weight_kg) || 0) >= ws.threshold_kg) distanceOut[i] *= ws.multiplier;
      });
    }
    distanceOut.forEach((f, i) => (out[i] += f));
  }

  if (cfg.weight?.enabled) {
    if (cfg.weight.mode === "threshold_group" && cfg.weight.threshold) {
      const th = cfg.weight.threshold;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const thCfg: any = {
        group_by: th.group_by,
        default: { threshold: th.default_threshold, rate: th.default_rate },
        rules: th.rules,
      };
      calcThresholdComponent(rows, thCfg).forEach((f, i) => (out[i] += f));
    } else {
      applyDim(cfg.weight, (r) => Number(r.weight_kg) || 0, out);
    }
  }

  // Skema flat murni dibedain per kolom/tipe pengiriman (rate_by ≠ "flat"),
  // TANPA tabel band Distance/Weight sama sekali — pengganti calc_type
  // "flat_unit" lama (rate_by="column"). rate_by/rates baru kepake lewat
  // band Distance/Weight (di atas), jadi kalau dua-duanya dimatiin, rates
  // yang udah diisi admin bakal nyantol gak pernah dipakai — di sini
  // diterapin langsung sebagai base fee per baris.
  // Area yang gak ke-match (district gak ada di `rates`, mis. beda format
  // penulisan atau kota di luar cakupan skema) jatuh ke `default_rate`,
  // BUKAN diam-diam Rp0 — dan dihitung ke `stats.unmatchedArea` biar
  // ke-warning di calcScheme (lihat riwayat: Noovoleum Cleaning rider
  // dibayar Rp0 total gara-gara district-nya gak match rate table).
  if (!cfg.distance?.enabled && !cfg.weight?.enabled && rateSettings.rate_by !== "flat") {
    const defaultRate = Number((cfg as { default_rate?: number }).default_rate) || 0;
    const billable = cfg.unit_basis === "unique_address" ? billableByUniqueAddress(rows) : null;
    const idxOf = new Map<DeliveryRow, number>();
    rows.forEach((r, i) => idxOf.set(r, i));
    rows.forEach((r) => {
      if (billable && !billable.has(r)) return;
      const hit = resolveRateHit(r, rateSettings);
      const i = idxOf.get(r)!;
      if (hit) {
        out[i] += Number(hit.rate) || 0;
      } else {
        out[i] += defaultRate;
        if (stats) stats.unmatchedArea++;
      }
    });
  }

  return out;
}

// ---------------- main ----------------
export function calcScheme(env: PricingEnvelope, rows: DeliveryRow[]): CalcResult {
  const warnings: string[] = [];
  const completed = rows.filter(isCompleted);
  const skipped = rows.length - completed.length;
  const skippedPerRider = buildSkippedPerRider(rows, riderKey);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cfg = env.config as any;

  // base fee per baris (index-aligned dgn `completed`) — didelegasikan ke
  // component murni per sub-tipe (lihat di atas).
  const byRider = groupBy(completed, riderKey);

  let baseByRow: number[];
  const modStats = { unmatchedArea: 0 };
  if (env.type === "flat_unit") {
    baseByRow = calcFlatComponent(completed, cfg);
  } else if (env.type === "tier") {
    baseByRow = calcTierComponent(completed, cfg, "per_order");
  } else if (env.type === "tier_daily") {
    baseByRow = calcTierComponent(completed, cfg, "daily");
  } else if (env.type === "threshold_multiple") {
    baseByRow = calcThresholdComponent(completed, cfg);
  } else if (env.type === "modular_v2") {
    baseByRow = calcModularDeliveryComponent(completed, cfg as ModularDeliveryConfig, modStats);
  } else {
    baseByRow = new Array(completed.length).fill(0);
  }
  if (modStats.unmatchedArea > 0) {
    warnings.push(
      `${modStats.unmatchedArea} pengiriman area/district-nya gak ke-match rate manapun di skema ini — pakai rate default (cek kolom Area/district-nya, mungkin beda format sama rate table).`,
    );
  }

  const idxOf = new Map<DeliveryRow, number>();
  completed.forEach((r, i) => idxOf.set(r, i));

  // ---- modifier per baris ----
  const addByRow = new Array(completed.length).fill(0);
  const mdByRow = new Array(completed.length).fill(0);

  if (env.add_kg && env.type !== "attendance") {
    completed.forEach((r, i) => (addByRow[i] = stepTierFee(env.add_kg!.tier, r.weight_kg ?? 0)));
  }
  if (env.multi_drop) {
    const fee = Number(env.multi_drop.fee_per_extra_shipment) || 0;
    for (const [, rrows] of byRider) {
      const byDay = groupBy(rrows, (r) => r.delivery_date);
      for (const [, drows] of byDay) {
        drows.forEach((r, i) => (mdByRow[idxOf.get(r)!] = i === 0 ? 0 : fee)); // kiriman ke-2 dst
      }
    }
  }

  // ---- rakit perRow + perRider ----
  const perRow: RowFee[] = completed.map((r, i) => ({
    id: r.id ?? null,
    rider: riderKey(r),
    date: r.delivery_date,
    base: baseByRow[i],
    add_kg: addByRow[i],
    multi_drop: mdByRow[i],
    fee: baseByRow[i] + addByRow[i] + mdByRow[i],
  }));

  // ---- deteksi anomali sederhana — jangan gagalin komputasi, cuma diflag ----
  const dependsOnWeight =
    !!env.add_kg ||
    (["tier", "tier_daily"].includes(env.type) && !!cfg?.weight) ||
    (env.type === "modular_v2" && !!(cfg as ModularDeliveryConfig)?.weight?.enabled);
  // modular_v2 dengan rate_by="column"/"delivery_type" (mis. skema Noovoleum
  // Cleaning: 1 band Jarak 0-10000 flat cuma dipakai sebagai "gerbang" biar
  // tabel tarif per-Area kepake) TIDAK beneran pakai nilai jarak buat nentuin
  // nominal — nominalnya dari rate table, band jarak cuma syarat lolos/nggak.
  // Baris kayak gini SALAH kalau di-flag "jarak 0 tapi kena fee": jaraknya
  // emang gak pernah dipakai buat itung, jadi 0/kosong bukan anomali.
  const modCfg = cfg as ModularDeliveryConfig;
  const distanceDrivesAmount =
    env.type === "modular_v2" &&
    !!modCfg?.distance?.enabled &&
    (modCfg.rate_by === "flat" || (modCfg.distance.rows ?? []).some((b) => b.type !== "flat"));
  const dependsOnDistance = (["tier", "tier_daily"].includes(env.type) && !!cfg?.distance) || distanceDrivesAmount;
  const anomalies: RowAnomaly[] = [];
  completed.forEach((r, i) => {
    const fee = perRow[i].fee;
    const dist = Number(r.distance_km) || 0;
    if (dependsOnDistance && (!r.distance_km || dist === 0) && fee > 0) {
      anomalies.push({ rider: riderKey(r), date: r.delivery_date, awb: r.awb, kind: "zero_distance_paid", detail: `Jarak 0/kosong tapi kena fee ${fee.toLocaleString("id-ID")}` });
    }
    if (dependsOnWeight && (r.weight_kg === null || r.weight_kg === undefined)) {
      anomalies.push({ rider: riderKey(r), date: r.delivery_date, awb: r.awb, kind: "missing_weight", detail: "Berat kosong padahal skema butuh berat" });
    }
    if (fee === 0) {
      anomalies.push({ rider: riderKey(r), date: r.delivery_date, awb: r.awb, kind: "zero_fee", detail: "Fee 0 padahal status COMPLETED — cek apakah ada tarif yang cocok" });
    }
  });

  const riderMap = new Map<string, RiderLine>();
  perRow.forEach((rf) => {
    const line = riderMap.get(rf.rider) ?? { rider: rf.rider, units: 0, base: 0, add_kg: 0, multi_drop: 0, total: 0 };
    line.units += 1;
    line.base += rf.base;
    line.add_kg += rf.add_kg;
    line.multi_drop += rf.multi_drop;
    line.total += rf.fee;
    riderMap.set(rf.rider, line);
  });
  const perRider = [...riderMap.values()].sort((a, b) => b.total - a.total);

  const subtotal = perRow.reduce((s, r) => s + r.fee, 0);

  // ---- billing add-ons (khusus scheme client) → level invoice ----
  const { billing, grandTotal } = applyBillingAddons(subtotal, env.billing_addons);

  if (skipped > 0) warnings.push(`${skipped} baris di-skip (status bukan COMPLETED).`);

  return { perRow, perRider, subtotal, billing, grandTotal, completedRows: completed.length, skippedRows: skipped, skippedPerRider, warnings, anomalies };
}

// =========================================================
// Type E (Attendance) — data absensi harian, BEDA bentuk dari
// DeliveryRow, jadi engine-nya kepisah sendiri.
// Rumus: (fee_penuh × proporsi_jam_kerja) [+ lembur] + insentif
// (nominal insentif ditentuin di skema; data cuma dipakai cek syarat,
// mis. OTP=ONTIME buat insentif "ontime_only", biner: penuh/nol).
// =========================================================
export interface AttendanceLogRow {
  id?: string | null;
  rider_id?: string | null;
  driver_code?: string | null;
  log_date: string;
  clock_in?: string | null; // "HH:MM" atau "HH:MM:SS" — dipakai buat deteksi shift
  duration_minutes?: number | null;
  is_late?: boolean | null;
  is_absent?: boolean | null;
}

// Konfigurasi 1 shift (opsional, di dalam config skema attendance yang sama —
// bukan tabel terpisah). Kalau `cfg.shifts` kosong/tidak ada, perilaku PERSIS
// seperti sebelum shift ditambahkan (1 tarif flat, tidak ada deteksi jam).
// Shift PURE cuma nentuin jam kerja & tarif — insentif/ontime TETAP dari
// `incentives` di config atas (pakai `is_late` yang udah ada dari data upload),
// satu sumber kebenaran, tidak ada penentuan ontime kedua di sini.
export interface ShiftConfig {
  shift_number: number;
  label: string;
  start_time: string; // "HH:MM" — jam clock-in mulai masuk shift ini
  end_time: string;   // "HH:MM" — batas atas (eksklusif)
  full_fee: number;
  standard_minutes: number;
  // Opsional: batas jam ontime. Clock-in LEWAT jam ini = telat → insentif
  // ontime_only tidak cair. Kalau kosong, telat pakai flag is_late dari data
  // (mis. kolom OTP upload). Contoh Alfagift: shift pagi "06:10", siang "14:10".
  late_after?: string; // "HH:MM"
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map((x) => parseInt(x, 10));
  return (h || 0) * 60 + (m || 0);
}

// Cari shift yang cocok berdasar jam clock-in. Kalau tidak ada yang cocok
// (clock-in di luar semua jendela shift, atau clock_in kosong), return null
// — caller fallback ke tarif flat (cfg.full_fee/standard_minutes lama).
// Exported juga buat finance-worksheet.tsx — dipakai nge-label ulang shift
// per baris attendance di Reports (data ini gak disimpan permanen, cuma
// dipakai sesaat pas hitung fee, jadi di-derive ulang dari config skema
// yang berlaku SEKARANG — sama seperti Rate Card panel yang juga baca
// skema saat ini, bukan snapshot historis pas commit).
export function findShiftFor(clockIn: string | null | undefined, shifts: ShiftConfig[]): ShiftConfig | null {
  if (!clockIn) return null;
  const m = timeToMinutes(clockIn);
  for (const s of shifts) {
    const start = timeToMinutes(s.start_time);
    const end = timeToMinutes(s.end_time);
    if (end > start ? (m >= start && m < end) : (m >= start || m < end)) return s; // handle shift lewat tengah malam
  }
  return null;
}

export interface AttendanceRowFee {
  id?: string | null;
  rider: string;
  date: string;
  base: number;
  overtime: number;
  incentive: number;
  delivery_component: number; // dari delivery_component config (0 kalau tidak ada)
  fee: number; // base + overtime + incentive + delivery_component
}

export interface AttendanceRiderLine {
  rider: string;
  daysWorked: number;
  base: number;
  overtime: number;
  incentive: number;
  delivery_component: number;
  total: number;
}

export interface AttendanceCalcResult {
  perRow: AttendanceRowFee[];
  perRider: AttendanceRiderLine[];
  subtotal: number;
  billing?: CalcResult["billing"];
  grandTotal: number;
  totalRows: number;
  absentRows: number;
  warnings: string[];
}

export interface CombinedRiderLine {
  rider: string;
  daysWorked: number;
  units: number;
  daily_base: number;
  ontime_bonus: number;
  per_order: number;
  total: number;
}

export interface CombinedCalcResult {
  perRow: RowFee[];
  perRider: CombinedRiderLine[];
  subtotal: number;
  billing?: CalcResult["billing"];
  grandTotal: number;
  completedRows: number;
  skippedRows: number;
  skippedPerRider: SkippedRiderLine[];
  warnings: string[];
  anomalies: RowAnomaly[];
}

// ---------------- pure component (Kategori 2 — Per Kehadiran) ----------------
// Terima attendance logs (index-aligned dengan output), kembaliin
// {daily_base, overtime, incentive} PER RIDER PER HARI (1 log = 1 rider-hari).
// Murni: tanpa bookkeeping absentRows/warnings — itu tetap tanggung jawab
// wrapper (calcAttendanceScheme) / calcHybridScheme. Lihat §5.
export interface AttendanceComponentResult {
  daily_base: number;
  overtime: number;
  incentive: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function calcAttendanceComponent(logs: AttendanceLogRow[], cfg: any): AttendanceComponentResult[] {
  const fullFee = Number(cfg.full_fee) || 0;
  const standardMin = Number(cfg.standard_minutes) || 0;
  const overtimeOn = !!cfg.overtime?.enabled;
  const overtimeRatePerHour = Number(cfg.overtime?.rate_per_hour) || 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const incentives: any[] = cfg.incentives ?? [];
  const shifts: ShiftConfig[] = Array.isArray(cfg.shifts) ? cfg.shifts : [];

  return logs.map((r) => {
    if (r.is_absent) {
      return { daily_base: 0, overtime: 0, incentive: 0 };
    }
    const actualMin = Number(r.duration_minutes) || 0;

    // Kalau skema punya config shift DAN clock-in-nya cocok ke salah satu
    // jendela shift itu — shift itu CUMA nentuin tarif (full_fee) & jam
    // standar buat proporsi daily_base. Kalau tidak cocok (skema tanpa
    // shifts, atau clock-in di luar semua jendela) — fallback ke tarif flat
    // (cfg.full_fee/standard_minutes lama). Insentif/ontime SELALU dari
    // `incentives` di bawah — satu sumber kebenaran, tidak diduplikasi per shift.
    const shift = shifts.length > 0 ? findShiftFor(r.clock_in, shifts) : null;
    const effFullFee = shift ? (Number(shift.full_fee) || 0) : fullFee;
    const effStandardMin = shift ? (Number(shift.standard_minutes) || 0) : standardMin;

    // Clamp ke [0,1] — duration_minutes negatif (data absen rusak, mis. jam
    // keluar ke-input sebelum jam masuk) bisa bikin proportion negatif tanpa
    // batas bawah ini, dan daily_base di bawah jadi ANGKA MINUS (rider
    // ke-charge-balik), bukan cuma Rp0.
    const proportion = effStandardMin > 0 ? Math.max(0, Math.min(1, actualMin / effStandardMin)) : (actualMin > 0 ? 1 : 0);
    const daily_base = Math.round(effFullFee * proportion);

    let overtime = 0;
    if (overtimeOn && effStandardMin > 0 && actualMin > effStandardMin) {
      overtime = Math.round(((actualMin - effStandardMin) / 60) * overtimeRatePerHour);
    }

    // Telat: kalau shift punya `late_after`, hitung dari clock-in vs jam itu
    // (config-driven, per-client). Kalau tidak, pakai flag is_late dari data.
    let late = !!r.is_late;
    if (shift && shift.late_after && r.clock_in) {
      late = timeToMinutes(r.clock_in) > timeToMinutes(shift.late_after);
    }

    let incentive = 0;
    for (const inc of incentives) {
      const amount = Number(inc.amount) || 0;
      if (inc.condition === "always") incentive += amount;
      else if (inc.condition === "ontime_only" && !late) incentive += amount;
    }

    return { daily_base, overtime, incentive };
  });
}

// =========================================================
// Kategori 3 (Hybrid) — kombinasi Kategori 1 (delivery component) +
// Kategori 2 (attendance component), dijumlah pakai allocInt() yang sudah
// ada. Bukan engine baru — cuma pemanggil component + alokasi.
// Dulunya `calcCombinedScheme()` (reimplementasi ulang rumus proporsi jam +
// tier per-order); sekarang reuse calcTierComponent()/calcAttendanceComponent().
// =========================================================
export function calcHybridScheme(
  env: PricingEnvelope,
  deliveries: DeliveryRow[],
  attendanceLogs: AttendanceLogRow[],
): CombinedCalcResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cfg = env.config as any;
  const fullFee = Number(cfg.full_fee) || 0;
  const standardMin = Number(cfg.standard_minutes) || 0;
  const ontimeBonus = Number(cfg.ontime_bonus) || 0;
  const orderBy: "distance" | "weight" = cfg.order_by === "weight" ? "weight" : "distance";
  const orderTier = cfg.order_tier ?? null;

  const warnings: string[] = [];

  // attendance lookup: riderKey+date -> log
  const attMap = new Map<string, AttendanceLogRow>();
  for (const log of attendanceLogs) {
    const k = (log.rider_id || log.driver_code || "") + "|" + log.log_date;
    attMap.set(k, log);
  }

  const completed = deliveries.filter(isCompleted);
  const skipped = deliveries.length - completed.length;
  const skippedPerRider = buildSkippedPerRider(deliveries, riderKey);

  const idxOf = new Map<DeliveryRow, number>();
  completed.forEach((r, i) => idxOf.set(r, i));

  // ---- delivery component: subtype "tier", 1 dimensi aktif sesuai order_by ----
  const tierCfg = {
    distance: orderBy === "distance" ? orderTier : null,
    weight: orderBy === "weight" ? orderTier : null,
  };
  const perOrderByRow = calcTierComponent(completed, tierCfg, "per_order");

  // ---- attendance component: daily base + "ontime_bonus" sebagai incentive
  //      ontime_only tunggal (superset attendance standalone yang punya list) ----
  const byRider = groupBy(completed, riderKey);
  const riderDayKeys: string[] = [];
  for (const [rider, rrows] of byRider) {
    const byDay = groupBy(rrows, (r) => r.delivery_date);
    for (const [date] of byDay) riderDayKeys.push(rider + "|" + date);
  }
  // sintesis 1 "log" per rider-hari yang MUNCUL DI DATA PENGIRIMAN (bukan di
  // data absensi) — replikasi persis perilaku lama: rider-hari yang gak ada
  // log absensinya dianggap 0 (bukan error), rider-hari yang cuma ada di
  // absensi (tanpa kiriman) diabaikan (gak pernah dilihat, sama seperti dulu).
  const syntheticLogs: AttendanceLogRow[] = riderDayKeys.map((k) => {
    const log = attMap.get(k);
    if (log) return log;
    const sep = k.lastIndexOf("|");
    return { rider_id: k.slice(0, sep), log_date: k.slice(sep + 1), is_absent: true };
  });
  const attendanceCfg = {
    full_fee: fullFee,
    standard_minutes: standardMin,
    overtime: null,
    incentives: [{ amount: ontimeBonus, condition: "ontime_only" }],
  };
  const attComp = calcAttendanceComponent(syntheticLogs, attendanceCfg);
  const dailyMap = new Map<string, { daily_base: number; ontime_bonus: number }>();
  riderDayKeys.forEach((k, i) => {
    dailyMap.set(k, { daily_base: attComp[i].daily_base, ontime_bonus: attComp[i].incentive });
  });

  // allocate daily fee across deliveries of that day (proportional by distance/weight)
  const dailyAllocByRow = new Array(completed.length).fill(0);
  for (const [rider, rrows] of byRider) {
    const byDay = groupBy(rrows, (r) => r.delivery_date);
    for (const [date, drows] of byDay) {
      const day = dailyMap.get(rider + "|" + date);
      const totalDaily = (day?.daily_base ?? 0) + (day?.ontime_bonus ?? 0);
      const rawWeights = drows.map((r) => orderBy === "weight" ? (Number(r.weight_kg) || 0) : (Number(r.distance_km) || 0));
      const weights = rawWeights.some((w) => w > 0) ? rawWeights : drows.map(() => 1);
      const parts = allocInt(totalDaily, weights);
      drows.forEach((r, i) => (dailyAllocByRow[idxOf.get(r)!] = parts[i]));
    }
  }

  const perRow: RowFee[] = completed.map((r, i) => ({
    id: r.id ?? null,
    rider: riderKey(r),
    date: r.delivery_date,
    base: perOrderByRow[i] + dailyAllocByRow[i],
    add_kg: 0,
    multi_drop: 0,
    fee: perOrderByRow[i] + dailyAllocByRow[i],
  }));

  const anomalies: RowAnomaly[] = [];
  completed.forEach((r, i) => {
    if (orderBy === "distance" && (!r.distance_km || Number(r.distance_km) === 0))
      anomalies.push({ rider: riderKey(r), date: r.delivery_date, awb: r.awb, kind: "zero_distance_paid", detail: "Jarak 0/kosong padahal skema pakai jarak" });
    if (orderBy === "weight" && (r.weight_kg === null || r.weight_kg === undefined))
      anomalies.push({ rider: riderKey(r), date: r.delivery_date, awb: r.awb, kind: "missing_weight", detail: "Berat kosong padahal skema pakai berat" });
    if (perRow[i].fee === 0)
      anomalies.push({ rider: riderKey(r), date: r.delivery_date, awb: r.awb, kind: "zero_fee", detail: "Fee 0 — cek data jarak/berat & tarif" });
  });

  // perRider summary (breakdown 3 komponen)
  const riderSummary = new Map<string, CombinedRiderLine>();
  for (const [rider, rrows] of byRider) {
    const byDay = groupBy(rrows, (r) => r.delivery_date);
    let daily_base_total = 0;
    let ontime_bonus_total = 0;
    for (const [date] of byDay) {
      const d = dailyMap.get(rider + "|" + date);
      daily_base_total += d?.daily_base ?? 0;
      ontime_bonus_total += d?.ontime_bonus ?? 0;
    }
    const per_order_total = rrows.reduce((s, r) => s + perOrderByRow[idxOf.get(r)!], 0);
    riderSummary.set(rider, {
      rider,
      daysWorked: byDay.size,
      units: rrows.length,
      daily_base: daily_base_total,
      ontime_bonus: ontime_bonus_total,
      per_order: per_order_total,
      total: daily_base_total + ontime_bonus_total + per_order_total,
    });
  }
  const perRider = [...riderSummary.values()].sort((a, b) => b.total - a.total);
  const subtotal = perRider.reduce((s, r) => s + r.total, 0);
  const { billing, grandTotal } = applyBillingAddons(subtotal, env.billing_addons);

  if (skipped > 0) warnings.push(`${skipped} baris di-skip (status bukan COMPLETED).`);
  if (attendanceLogs.length === 0) warnings.push("Tidak ada data absensi — daily fee & bonus ontime tidak dihitung.");

  return { perRow, perRider, subtotal, billing, grandTotal, completedRows: completed.length, skippedRows: skipped, skippedPerRider, warnings, anomalies };
}

export function calcAttendanceScheme(env: PricingEnvelope, logs: AttendanceLogRow[], deliveryRows?: DeliveryRow[]): AttendanceCalcResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cfg = env.config as any;
  const standardMin = Number(cfg.standard_minutes) || 0;

  const warnings: string[] = [];
  if (standardMin <= 0) warnings.push("Jam standar shift belum diisi di skema — proporsi jam kerja tidak bisa dihitung dengan benar.");

  const comp = calcAttendanceComponent(logs, cfg);

  // ---- delivery_component (opsional) ----
  // Aggregate fee pengiriman per rider+hari, lalu ditambahkan ke fee absensi.
  const delivCompMap = new Map<string, number>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const delivCfg = (cfg.delivery_component as any) ?? null;
  if (delivCfg?.enabled && deliveryRows?.length) {
    const completed = deliveryRows.filter(isCompleted);
    let baseByRow: number[];
    if (delivCfg.method === "flat") {
      baseByRow = calcFlatComponent(completed, delivCfg);
    } else if (delivCfg.method === "threshold") {
      baseByRow = calcThresholdComponent(completed, delivCfg);
    } else {
      // tier (default) — window daily_rider = akumulasi harian, per_row = per kiriman
      const accumulate: "daily" | "per_order" = delivCfg.window === "daily_rider" ? "daily" : "per_order";
      const tierCfg = {
        distance: delivCfg.order_by === "distance" ? delivCfg.order_tier : null,
        weight: delivCfg.order_by === "weight" ? delivCfg.order_tier : null,
      };
      baseByRow = calcTierComponent(completed, tierCfg, accumulate);
    }
    completed.forEach((r, i) => {
      const k = riderKey(r) + "|" + r.delivery_date;
      delivCompMap.set(k, (delivCompMap.get(k) ?? 0) + baseByRow[i]);
    });
    if (completed.length === 0) warnings.push("delivery_component aktif tapi tidak ada data pengiriman di rentang ini.");
  }

  let absentRows = 0;
  const perRow: AttendanceRowFee[] = logs.map((r, i) => {
    if (r.is_absent) absentRows++;
    const c = comp[i];
    const delivComp = delivCompMap.get(riderKey(r) + "|" + r.log_date) ?? 0;
    return {
      id: r.id ?? null,
      rider: riderKey(r),
      date: r.log_date,
      base: c.daily_base,
      overtime: c.overtime,
      incentive: c.incentive,
      delivery_component: delivComp,
      fee: c.daily_base + c.overtime + c.incentive + delivComp,
    };
  });

  const riderMap = new Map<string, AttendanceRiderLine>();
  perRow.forEach((rf, i) => {
    const line = riderMap.get(rf.rider) ?? { rider: rf.rider, daysWorked: 0, base: 0, overtime: 0, incentive: 0, delivery_component: 0, total: 0 };
    if (!logs[i].is_absent) line.daysWorked += 1;
    line.base += rf.base;
    line.overtime += rf.overtime;
    line.incentive += rf.incentive;
    line.delivery_component += rf.delivery_component;
    line.total += rf.fee;
    riderMap.set(rf.rider, line);
  });
  const perRider = [...riderMap.values()].sort((a, b) => b.total - a.total);

  const subtotal = perRow.reduce((s, r) => s + r.fee, 0);
  const { billing, grandTotal } = applyBillingAddons(subtotal, env.billing_addons);
  if (absentRows > 0) warnings.push(`${absentRows} baris absen (fee 0).`);

  return { perRow, perRider, subtotal, billing, grandTotal, totalRows: logs.length, absentRows, warnings };
}
