// =========================================================
// Taksonomi baru (v2): 3 kategori, bukan 6 calc_type.
//
// - `PricingCategory` + `subtype` = apa yang dipilih user di UI (2 level:
//   kategori dulu, baru sub-tipe kalau relevan) dan apa yang disimpan di
//   kolom `calc_type` tabel `pricing_schemes` (kolom fisik BELUM diubah —
//   mapping ke/dari string lama dilakukan di
//   `pricing-store.ts` lewat `calcTypeToCategory` / `categoryToCalcType`).
// - `PricingCalcType` (union lama, 6 nilai) TETAP ADA tapi jadi detail
//   internal: `PricingEnvelope.type` masih memakainya persis seperti
//   sebelumnya, karena `pricing-calc.ts` (`calcScheme`, `calcHybridScheme`,
//   `calcAttendanceScheme`, `rate-card.ts`) mendispatch berdasarkan field
//   ini dan SENGAJA tidak disentuh di tahap ini. Konfig JSON di dalam
//   `params.config` juga tidak berubah bentuk sama sekali untuk semua
//   kategori (termasuk hybrid — lihat catatan di bawah `PricingEnvelope`).
// =========================================================

export type PricingCategory = "delivery" | "attendance" | "hybrid";

// =========================================================
// Modular v2 — Distance & Weight sebagai 2 dimensi checkbox (bukan 4
// modul flat/tierDistance/tierWeight/threshold seperti draft v1).
// Di dalam tiap dimensi, admin isi TABEL RANGE yang barisnya bisa
// campur tipe "flat" (harga tetap per band) atau "tier" (base + step
// per band, band-independent — bukan cumulative dari band sebelumnya).
// Weight punya mode tambahan: "range" (tabel biasa) atau
// "threshold_group" (dikelompokkan per store/area, dibagi threshold,
// dibulatkan ke atas × rate — pengganti "Threshold Kelipatan" lama).
// Lihat pricing-calc.ts `calcModularDeliveryComponent` untuk kalkulasi.
// =========================================================

/** Checkbox tingkat atas — dimensi mana yang dipakai di skema delivery ini. */
export interface DeliveryDimensions {
  distance: boolean;
  weight: boolean;
}

export type DeliverySubtype = DeliveryDimensions | null;
export type PricingSubtype = DeliverySubtype | null;

/** 1 baris di tabel range Distance/Weight. Band-independent: value dicari
 * masuk band [from,to) mana, dihitung base_fee (+ step kalau tier) BAND
 * ITU SAJA — band lain diabaikan (bukan akumulasi lewat semua band). */
export interface RangeRow {
  type: "flat" | "tier";
  from: number;
  to: number | null; // null = band terakhir, tak terbatas
  base_fee: number;
  step: number; // 0 untuk flat
  add_per_step: number; // 0 untuk flat
}

export interface RangeDimensionConfig {
  enabled: boolean;
  accumulate: "per_order" | "daily"; // value (km/kg) dihitung per baris atau diakumulasi per rider per hari dulu
  rows: RangeRow[];
}

/** Berat lewat batas -> fee Distance (bukan Weight) baris itu dikali N. Weight
 * (kalau aktif) tetap dihitung normal, gak ikut kali — cuma pemicu doang. */
export interface WeightSurcharge {
  enabled: boolean;
  threshold_kg: number;
  multiplier: number;
}

export interface ThresholdGroupConfig {
  group_by: string; // nama kolom buat grouping, cth "Area"
  default_threshold: number;
  default_rate: number;
  rules: { key: string; threshold: number; rate: number }[];
}

export interface WeightRangeConfig extends RangeDimensionConfig {
  mode: "range" | "threshold_group";
  threshold?: ThresholdGroupConfig;
}

export interface ModularDeliveryConfig {
  distance: RangeDimensionConfig | null;
  weight: WeightRangeConfig | null;
  // Setting global untuk baris bertipe "flat": rate bisa flat tunggal, beda
  // per kolom (cth Area), atau beda Delivery/Return. "unit_basis" dipakai
  // untuk dedup alamat & hitung stop count (multi-drop).
  rate_by: "flat" | "column" | "delivery_type";
  match_column: string;
  rates: { key: string; rate: number }[];
  // Rate buat baris yang district/kolom-nya GAK ke-match satupun `rates` di
  // atas (format beda, atau area di luar cakupan skema) — hanya berlaku pas
  // Distance & Weight dua-duanya mati (rate_by="column" murni tanpa band).
  // 0/kosong = area gak ke-match dianggap Rp0 (perilaku lama).
  default_rate: number;
  unit_basis: "awb" | "unique_address";
  // Tag ringan dimensi aktif — duplikat dari `distance`/`weight` di atas,
  // disimpan supaya `pricing-store.ts` bisa reconstruct `PricingScheme.subtype`
  // tanpa parsing config penuh (calcTypeToCategory cuma terima calc_type string).
  _dims: DeliveryDimensions;
  // Opsional, cuma relevan kalau Distance aktif — lihat WeightSurcharge.
  weight_surcharge?: WeightSurcharge | null;
}

export interface DeliveryDimensionOption {
  key: keyof DeliveryDimensions;
  name: string;
  desc: string;
  icon: string;
  callout: string;
}

export const DELIVERY_DIMENSIONS: DeliveryDimensionOption[] = [
  {
    key: "distance",
    name: "Distance",
    desc: "Tarif berdasarkan jarak (km)",
    icon: "Ruler",
    callout:
      "Tabel range jarak — tiap band bisa Flat (harga tetap) atau Tier (base + naik per step). Bisa dicampur dalam 1 tabel.",
  },
  {
    key: "weight",
    name: "Weight",
    desc: "Tarif berdasarkan berat (kg) — atau kelipatan per store",
    icon: "Package",
    callout:
      "Sama seperti Distance (tabel range Flat/Tier) — atau ganti mode ke 'Kelipatan per Store' untuk grouping berat per area/store lalu dibagi threshold.",
  },
];

/** Union lama (6 calc_type) — detail internal, lihat komentar di atas. */
export type PricingCalcType =
  | "flat_unit"
  | "tier"
  | "tier_daily"
  | "threshold_multiple"
  | "attendance"
  | "combined"
  | "modular_v2"
  | "revenue_share";

/** Fee rider = persentase dari revenue client per AWB (mis. rider dapat 80%
 * dari yang ditagihkan ke client, sisanya margin). Revenue-nya sendiri BUKAN
 * diisi di sini — diambil dari hasil kalkulasi skema Client (scheme_for=
 * "client") yang aktif untuk client+periode yang sama, lihat
 * `calcScheme(env, rows, clientRevenueByRow)` di pricing-calc.ts. */
export interface RevenueShareConfig {
  percent_to_rider: number; // 0-100
}

export type SchemeFor = "rider" | "client";

export interface PricingCategoryOption {
  key: PricingCategory;
  name: string;
  desc: string;
  icon: string; // lucide icon name (lihat ICONS di pricing-form)
  callout: string;
}

export const PRICING_CATEGORIES: PricingCategoryOption[] = [
  {
    key: "delivery",
    name: "Per Pengiriman",
    desc: "Dibayar per kiriman",
    icon: "Truck",
    callout:
      "Fee dihitung dari data pengiriman (delivery_records). Pilih sub-tipe di bawah: Flat per Unit, Tier Jarak & Berat, atau Threshold Kelipatan.",
  },
  {
    key: "attendance",
    name: "Per Kehadiran",
    desc: "Base harian + komponen (± kiriman)",
    icon: "CalendarDays",
    callout:
      "Base fee harian proporsional jam kerja (dari data absensi) + insentif opsional. Toggle 'Komponen per kiriman' untuk tambah fee per pengiriman (menggantikan tipe Kombinasi lama).",
  },
  // "hybrid" tidak muncul di UI lagi — scheme lama tetap terbaca.
  // Skema baru pakai category "attendance" + delivery_component toggle.
];

/** Label tampil gabungan kategori+subtype, dipakai di daftar/preview skema. */
export function pricingLabel(category: PricingCategory, subtype: PricingSubtype): string {
  if (category === "attendance") return "Daily / Attendance";
  if (category === "hybrid") return "Kombinasi (Daily + Per Order)";

  if (!subtype) return "Per Pengiriman";

  const dims = subtype as DeliveryDimensions;
  const enabled: string[] = [];
  if (dims.distance) enabled.push("Distance");
  if (dims.weight) enabled.push("Weight");

  if (enabled.length === 0) return "Per Pengiriman";
  return enabled.join(" + ");
}

/**
 * Mapping DARI nilai `calc_type` lama (kolom fisik di tabel) KE {category, subtype}
 * yang dipakai UI/aplikasi. `subtype` sekarang cuma tag ringan (dimensi mana yang
 * aktif) — detail lengkap (rows, mode, threshold) direkonstruksi terpisah saat
 * form dibuka utk edit (lihat `loadDeliveryState` di delivery-fields.tsx).
 *
 * - "flat_unit" → dianggap pakai dimensi Distance (flat row 0..∞)
 * - "tier" / "tier_daily" → Distance + Weight (tier lama support dua-duanya)
 * - "threshold_multiple" → Weight (mode threshold_group)
 */
export function calcTypeToCategory(calcType: string): { category: PricingCategory; subtype: PricingSubtype } {
  switch (calcType) {
    case "flat_unit":
      return { category: "delivery", subtype: { distance: true, weight: false } };
    case "tier":
    case "tier_daily":
      return { category: "delivery", subtype: { distance: true, weight: true } };
    case "threshold_multiple":
      return { category: "delivery", subtype: { distance: false, weight: true } };
    case "modular_v2":
      return { category: "delivery", subtype: { distance: true, weight: true } }; // detail sebenarnya dibaca dari config
    case "revenue_share":
      return { category: "delivery", subtype: null };
    case "attendance":
      return { category: "attendance", subtype: null };
    case "combined":
      return { category: "hybrid", subtype: null };
    default:
      return { category: "delivery", subtype: { distance: true, weight: false } };
  }
}

// -------------------- Bentuk "amplop" params (envelope) --------------------
// Dipakai lintas tipe. Modifier nempel di luar `config` supaya bisa on/off
// tanpa ganggu isi tiap tipe. `null` = modifier mati.
export interface StepTier {
  base_fee: number;
  base_until: number;
  tiers: { from: number; to: number | null; step: number; add_per_step: number }[];
}

export interface AddKg {
  enabled: true;
  tier: StepTier;
}

export interface MultiDrop {
  fee_per_extra_shipment: number; // otomatis mulai kiriman ke-2 per rider per hari
}

export interface BillingAddons {
  min_charge: number;
  admin_fee_flat: number;
  // Management fee = persen dari operational (subtotal revenue). Beda-beda per
  // client, ada yang kena ada yang nggak — 0/kosong = gak kena, gak muncul di
  // invoice. Umumnya dipakai client skema attendance/daily.
  management_fee_percent: number;
  ppn_percent: number;
}

// Bentuk `params` (envelope) TIDAK BERUBAH oleh redesign modular_v2 —
// termasuk untuk hybrid (dulu "combined"): `calcHybridScheme()` di
// pricing-calc.ts masih membaca `config` sebagai objek flat (full_fee/
// standard_minutes/ontime_bonus/order_by/order_tier), belum diseragamkan ke
// bentuk delivery_config/attendance_config kayak Distance/Weight — hybrid
// sengaja belum ikut migrasi ini (non-goal: jangan sentuh pricing-calc.ts
// atau database). `type` dipertahankan persis seperti semula karena jadi
// kunci dispatch internal `calcScheme()`.
export interface PricingEnvelope {
  version: number;
  type: PricingCalcType;
  config: Record<string, unknown>; // isi spesifik per tipe
  add_kg: AddKg | null;
  multi_drop: MultiDrop | null;
  billing_addons: BillingAddons | null; // hanya untuk scheme_for = 'client'
}

export interface PricingScheme {
  id: string;
  name: string;
  client_id: string | null;
  client_name?: string | null;
  scheme_for: SchemeFor;
  category: PricingCategory;
  subtype: PricingSubtype;
  effective_from: string; // info saja, bukan logika kalkulasi
  effective_to: string | null;
  params: PricingEnvelope;
  created_at: string;
}
