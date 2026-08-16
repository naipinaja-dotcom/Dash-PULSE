import { describe, it, expect } from "vitest";
import {
  stepTierFee,
  calcScheme,
  calcAttendanceScheme,
  calcHybridScheme,
  bandLookupFee,
  bandFeeAt,
  type DeliveryRow,
} from "@/lib/pricing-calc";
import type { PricingEnvelope, StepTier } from "@/lib/pricing-types";

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------
function env(partial: Partial<PricingEnvelope> & Pick<PricingEnvelope, "type" | "config">): PricingEnvelope {
  return {
    version: 1,
    add_kg: null,
    multi_drop: null,
    billing_addons: null,
    ...partial,
  };
}

function row(p: Partial<DeliveryRow>): DeliveryRow {
  return {
    delivery_date: "2026-07-01",
    status: "COMPLETED",
    ...p,
  };
}

const stepTier = (base_fee: number, tiers: StepTier["tiers"], base_until = 0): StepTier => ({
  base_fee,
  base_until,
  tiers,
});

// ==================================================================
// stepTierFee — the tiered-band primitive used everywhere
// ==================================================================
describe("stepTierFee", () => {
  const tier = stepTier(5000, [
    { from: 2, to: 10, step: 1, add_per_step: 1000 },
    { from: 10, to: null, step: 1, add_per_step: 2000 },
  ]);

  it("returns 0 for a null/undefined tier", () => {
    expect(stepTierFee(null, 5)).toBe(0);
    expect(stepTierFee(undefined, 5)).toBe(0);
  });

  it("returns only base_fee when value is within the base band", () => {
    expect(stepTierFee(tier, 0)).toBe(5000);
    expect(stepTierFee(tier, 2)).toBe(5000); // boundary: v > from is strict
  });

  it("adds per-step within the first band", () => {
    // 5>2 -> span=3 -> ceil(3/1)*1000 = 3000
    expect(stepTierFee(tier, 5)).toBe(8000);
  });

  it("spans multiple bands using the open-ended last tier", () => {
    // band1: min(12,10)-2 = 8 -> 8000 ; band2: 12-10 = 2 -> 4000
    expect(stepTierFee(tier, 12)).toBe(5000 + 8000 + 4000);
  });

  it("rounds each step up (ceil) so partial steps still charge a full step", () => {
    const t = stepTier(0, [{ from: 0, to: null, step: 5, add_per_step: 1000 }]);
    expect(stepTierFee(t, 1)).toBe(1000); // ceil(1/5)=1
    expect(stepTierFee(t, 5)).toBe(1000); // ceil(5/5)=1
    expect(stepTierFee(t, 6)).toBe(2000); // ceil(6/5)=2
  });

  it("coerces non-numeric / missing step to sane defaults", () => {
    const t = stepTier(1000, [{ from: 0, to: null, step: 0 as unknown as number, add_per_step: 500 }]);
    // step 0 -> defaults to 1
    expect(stepTierFee(t, 3)).toBe(1000 + 3 * 500);
  });
});

describe("bandLookupFee", () => {
  it("matches the band whose [from,to) contains the value", () => {
    const rows = [
      { type: "flat" as const, from: 0, to: 10, base_fee: 20000, step: 0, add_per_step: 0 },
      { type: "tier" as const, from: 10, to: 1000, base_fee: 20000, step: 1, add_per_step: 2000 },
    ];
    expect(bandLookupFee(rows, 5).fee).toBe(20000);
    expect(bandLookupFee(rows, 15).fee).toBe(20000 + 5 * 2000); // ceil((15-10)/1)*2000
  });

  it("falls back to the previous band's rate (capped at its own upper edge) when the value lands in a gap between bands", () => {
    // Gap: band 1 berlaku sampai 10 (eksklusif), band 2 baru mulai 10.1 —
    // jarak persis 10 gak masuk band manapun secara harfiah.
    const rows = [
      { type: "flat" as const, from: 0, to: 10, base_fee: 20000, step: 0, add_per_step: 0 },
      { type: "tier" as const, from: 10.1, to: 1000, base_fee: 20000, step: 1, add_per_step: 2000 },
    ];
    const res = bandLookupFee(rows, 10);
    expect(res.fee).toBe(20000); // baserate band 1, bukan Rp0
    expect(res.band?.from).toBe(0);
  });

  it("still returns 0 when the value is below the very first band (no lower band to fall back to)", () => {
    const rows = [{ type: "flat" as const, from: 5, to: 10, base_fee: 20000, step: 0, add_per_step: 0 }];
    expect(bandLookupFee(rows, 2).fee).toBe(0);
  });

  it("keeps growing with the actual value (not capped) when the value is beyond the LAST band in the table (table simply stops there, not a gap)", () => {
    // Flat 0-20, Tier 20.1-50 (base 0, +2000/kg) — nothing defined above 50.
    // Weight 52 dan 100 harus tetap beda (numpuk terus), bukan mentok di
    // angka yang sama kayak weight 50.
    const rows = [
      { type: "flat" as const, from: 0, to: 20, base_fee: 0, step: 0, add_per_step: 0 },
      { type: "tier" as const, from: 20.1, to: 50, base_fee: 0, step: 1, add_per_step: 2000 },
    ];
    // ceil((52-20.1)/1)*2000 = ceil(31.9)*2000 = 32*2000 = 64000
    expect(bandLookupFee(rows, 52).fee).toBe(64000);
    // ceil((100-20.1)/1)*2000 = 80*2000 = 160000 — beda dari 52kg, gak mentok
    expect(bandLookupFee(rows, 100).fee).toBe(160000);
  });

  it("still caps at the boundary for a gap in the MIDDLE of the table (a higher band exists further up)", () => {
    const rows = [
      { type: "flat" as const, from: 0, to: 10, base_fee: 20000, step: 0, add_per_step: 0 },
      { type: "tier" as const, from: 10.1, to: 1000, base_fee: 20000, step: 1, add_per_step: 2000 },
    ];
    // v=10 kejepit di celah — ini bukan "tabel berhenti di situ" (masih ada
    // band Tier 10.1-1000 di atasnya), jadi tetap dipatok, bukan ikut v.
    expect(bandLookupFee(rows, 10).fee).toBe(20000);
  });
});

describe("bandFeeAt (dipakai delivery-fields.tsx buat auto-continue base fee baris baru)", () => {
  it("computes a tier band's fee at its own upper edge — the continuation value for the NEXT band's base_fee", () => {
    // Tier 20-50, base 0, +2000/kg -> di titik paling atas (50), fee harusnya
    // 60000 (bukan 0) — ini angka yang mestinya diwarisin baris berikutnya
    // waktu admin klik "Add Tier" (lihat delivery-fields.tsx addRow).
    const band = { type: "tier" as const, from: 20, to: 50, base_fee: 0, step: 1, add_per_step: 2000 };
    expect(bandFeeAt(band, 50)).toBe(60000);
  });

  it("returns base_fee as-is for a flat band regardless of value", () => {
    const band = { type: "flat" as const, from: 0, to: 10, base_fee: 15000, step: 0, add_per_step: 0 };
    expect(bandFeeAt(band, 10)).toBe(15000);
  });
});

// ==================================================================
// calcScheme — flat_unit
// ==================================================================
describe("calcScheme / flat_unit", () => {
  it("charges a flat rate per completed row", () => {
    const e = env({ type: "flat_unit", config: { rate_by: "flat", flat_rate: 10000 } });
    const rows = [
      row({ rider_id: "R1" }),
      row({ rider_id: "R1" }),
      row({ rider_id: "R2" }),
    ];
    const res = calcScheme(e, rows);
    expect(res.subtotal).toBe(30000);
    expect(res.completedRows).toBe(3);
    expect(res.perRider.find((r) => r.rider === "R1")?.total).toBe(20000);
  });

  it("skips non-COMPLETED rows and reports them per rider", () => {
    const e = env({ type: "flat_unit", config: { rate_by: "flat", flat_rate: 10000 } });
    const rows = [
      row({ rider_id: "R1", status: "COMPLETED" }),
      row({ rider_id: "R1", status: "PENDING_PICKUP" }),
      row({ rider_id: "R1", status: "FAILED" }),
    ];
    const res = calcScheme(e, rows);
    expect(res.completedRows).toBe(1);
    expect(res.skippedRows).toBe(2);
    expect(res.subtotal).toBe(10000);
    const skip = res.skippedPerRider.find((s) => s.rider === "R1");
    expect(skip?.count).toBe(2);
    expect(skip?.statuses).toEqual({ PENDING_PICKUP: 1, FAILED: 1 });
    expect(res.warnings.some((w) => w.includes("di-skip"))).toBe(true);
  });

  it("treats status case-insensitively ('completed' == 'COMPLETED')", () => {
    const e = env({ type: "flat_unit", config: { rate_by: "flat", flat_rate: 1000 } });
    const res = calcScheme(e, [row({ rider_id: "R1", status: "completed" })]);
    expect(res.completedRows).toBe(1);
    expect(res.subtotal).toBe(1000);
  });

  it("unique_address: same address same day counts once (rest billed 0)", () => {
    const e = env({ type: "flat_unit", config: { unit: "unique_address", rate_by: "flat", flat_rate: 8000 } });
    const rows = [
      row({ rider_id: "R1", destination_address: "Jl. Mawar 1" }),
      row({ rider_id: "R1", destination_address: "jl. mawar 1" }), // same after norm -> 0
      row({ rider_id: "R1", destination_address: "Jl. Melati 2" }),
    ];
    const res = calcScheme(e, rows);
    expect(res.subtotal).toBe(16000);
  });

  it("rate table: matches by column value, falls back to default_rate", () => {
    const e = env({
      type: "flat_unit",
      config: {
        rate_by: "table",
        match_column: "district",
        rates: [{ key: "JAKARTA", rate: 5000 }],
        default_rate: 3000,
      },
    });
    const rows = [
      row({ rider_id: "R1", district: "Jakarta" }), // matched (case-insensitive) -> 5000
      row({ rider_id: "R1", district: "Bandung" }), // default -> 3000
    ];
    const res = calcScheme(e, rows);
    expect(res.subtotal).toBe(8000);
  });

  it("rate table: area override matches even when 'Kota'/'Kabupaten' prefix differs", () => {
    // Override keys are typed manually with the admin prefix ("Kota Jakarta
    // Pusat"), but reverse-geocoded district values come back bare
    // ("Jakarta Pusat") — the prefix must not block the match.
    const e = env({
      type: "flat_unit",
      config: {
        rate_by: "table",
        match_column: "district",
        rates: [{ key: "Kota Jakarta Pusat", rate: 12000 }],
        default_rate: 3000,
      },
    });
    const rows = [row({ rider_id: "R1", district: "Jakarta Pusat" })];
    const res = calcScheme(e, rows);
    expect(res.subtotal).toBe(12000);
  });
});

// ==================================================================
// calcScheme — tier (distance + weight)
// ==================================================================
describe("calcScheme / tier", () => {
  it("sums distance-tier and weight-tier fees per row", () => {
    const e = env({
      type: "tier",
      config: {
        distance: stepTier(5000, [{ from: 2, to: null, step: 1, add_per_step: 1000 }]),
        weight: stepTier(0, [{ from: 0, to: null, step: 1, add_per_step: 500 }]),
      },
    });
    // distance 5 -> 5000 + ceil(3)*1000 = 8000 ; weight 2 -> 2*500 = 1000
    const res = calcScheme(e, [row({ rider_id: "R1", distance_km: 5, weight_kg: 2 })]);
    expect(res.perRow[0].base).toBe(9000);
    expect(res.subtotal).toBe(9000);
  });
});

// ==================================================================
// calcScheme — tier_daily (accumulate per rider per day, then allocate)
// ==================================================================
describe("calcScheme / tier_daily", () => {
  it("sums the day's distance first, then allocates the day fee across rows exactly", () => {
    const e = env({
      type: "tier_daily",
      config: {
        distance: stepTier(0, [{ from: 0, to: null, step: 1, add_per_step: 1000 }]),
      },
    });
    // day total km = 3 + 7 = 10 -> dayFee = 10*1000 = 10000
    const rows = [
      row({ rider_id: "R1", distance_km: 3 }),
      row({ rider_id: "R1", distance_km: 7 }),
    ];
    const res = calcScheme(e, rows);
    expect(res.subtotal).toBe(10000); // allocation must sum exactly to dayFee
    const allocated = res.perRow.reduce((s, r) => s + r.base, 0);
    expect(allocated).toBe(10000);
    // proportional: heavier-distance row gets more
    expect(res.perRow[1].base).toBeGreaterThan(res.perRow[0].base);
  });
});

// ==================================================================
// calcScheme — threshold_multiple
// ==================================================================
describe("calcScheme / threshold_multiple", () => {
  it("rounds total weight up to the threshold multiple, per group per day", () => {
    const e = env({
      type: "threshold_multiple",
      config: {
        group_by: "district",
        rules: [{ key: "TOKO A", threshold: 10, rate: 20000 }],
        default: { threshold: 10, rate: 15000 },
      },
    });
    // total 23kg / threshold 10 -> ceil(2.3)=3 -> 3 * 20000 = 60000
    const rows = [
      row({ rider_id: "R1", district: "Toko A", weight_kg: 10 }),
      row({ rider_id: "R1", district: "Toko A", weight_kg: 13 }),
    ];
    const res = calcScheme(e, rows);
    expect(res.subtotal).toBe(60000);
  });
});

describe("calcScheme / revenue_share", () => {
  it("rider fee = percent of client revenue per row; rest is margin", () => {
    const e = env({ type: "revenue_share", config: { percent_to_rider: 80 } });
    const rows = [row({ rider_id: "R1" }), row({ rider_id: "R1" })];
    const res = calcScheme(e, rows, [10000, 5000]);
    expect(res.perRow[0].fee).toBe(8000);
    expect(res.perRow[1].fee).toBe(4000);
    expect(res.revenueShare).toEqual({ totalRevenue: 15000, totalMargin: 3000 });
  });

  it("flags 0 fee and warns when client revenue isn't provided", () => {
    const e = env({ type: "revenue_share", config: { percent_to_rider: 80 } });
    const res = calcScheme(e, [row({ rider_id: "R1" })]);
    expect(res.perRow[0].fee).toBe(0);
    expect(res.warnings).toContain("Revenue client belum dihitung — fee rider tidak bisa dihitung (0 semua).");
  });
});

// ==================================================================
// Modifiers: add_kg + multi_drop
// ==================================================================
describe("calcScheme / modifiers", () => {
  it("add_kg surcharge stacks on top of the base fee", () => {
    const e = env({
      type: "flat_unit",
      config: { rate_by: "flat", flat_rate: 10000 },
      add_kg: { enabled: true, tier: stepTier(0, [{ from: 5, to: null, step: 1, add_per_step: 1000 }]) },
    });
    // weight 8 -> add = ceil(3)*1000 = 3000
    const res = calcScheme(e, [row({ rider_id: "R1", weight_kg: 8 })]);
    expect(res.perRow[0].base).toBe(10000);
    expect(res.perRow[0].add_kg).toBe(3000);
    expect(res.perRow[0].fee).toBe(13000);
  });

  it("multi_drop charges from the 2nd shipment per rider per day", () => {
    const e = env({
      type: "flat_unit",
      config: { rate_by: "flat", flat_rate: 10000 },
      multi_drop: { fee_per_extra_shipment: 2000 },
    });
    const rows = [
      row({ rider_id: "R1", delivery_date: "2026-07-01" }), // 1st -> 0
      row({ rider_id: "R1", delivery_date: "2026-07-01" }), // 2nd -> 2000
      row({ rider_id: "R1", delivery_date: "2026-07-02" }), // 1st of new day -> 0
    ];
    const res = calcScheme(e, rows);
    const md = res.perRow.map((r) => r.multi_drop);
    expect(md).toEqual([0, 2000, 0]);
    expect(res.subtotal).toBe(30000 + 2000);
  });
});

// ==================================================================
// Billing add-ons (client scheme) — invoice-level
// ==================================================================
describe("calcScheme / billing_addons", () => {
  it("applies min charge floor, admin fee, then PPN last", () => {
    const e = env({
      type: "flat_unit",
      config: { rate_by: "flat", flat_rate: 10000 },
      billing_addons: { min_charge: 50000, admin_fee_flat: 5000, ppn_percent: 11 },
    });
    // subtotal = 10000, floored up to 50000, + admin 5000 = 55000, ppn 11% = 6050
    const res = calcScheme(e, [row({ rider_id: "R1" })]);
    expect(res.subtotal).toBe(10000);
    expect(res.billing?.floored).toBe(true);
    expect(res.billing?.admin_fee).toBe(5000);
    expect(res.billing?.ppn).toBeCloseTo(6050, 5);
    expect(res.grandTotal).toBeCloseTo(61050, 5);
  });

  it("does not floor when subtotal already exceeds min charge", () => {
    const e = env({
      type: "flat_unit",
      config: { rate_by: "flat", flat_rate: 100000 },
      billing_addons: { min_charge: 50000, admin_fee_flat: 0, ppn_percent: 0 },
    });
    const res = calcScheme(e, [row({ rider_id: "R1" })]);
    expect(res.billing?.floored).toBe(false);
    expect(res.grandTotal).toBe(100000);
  });
});

// ==================================================================
// Anomaly flags — never fail the calc, just surface them
// ==================================================================
describe("calcScheme / anomalies", () => {
  it("flags zero_distance_paid, missing_weight and zero_fee", () => {
    const e = env({
      type: "tier",
      config: {
        distance: stepTier(5000, []), // fee 5000 even at 0 km
        weight: stepTier(0, [{ from: 0, to: null, step: 1, add_per_step: 100 }]),
      },
    });
    const res = calcScheme(e, [
      row({ rider_id: "R1", distance_km: 0, weight_kg: null }), // zero distance but paid + missing weight
    ]);
    const kinds = res.anomalies.map((a) => a.kind);
    expect(kinds).toContain("zero_distance_paid");
    expect(kinds).toContain("missing_weight");
  });

  it("flags zero_fee when a completed row earns nothing", () => {
    const e = env({ type: "flat_unit", config: { rate_by: "flat", flat_rate: 0 } });
    const res = calcScheme(e, [row({ rider_id: "R1", distance_km: 5 })]);
    expect(res.anomalies.some((a) => a.kind === "zero_fee")).toBe(true);
  });
});

// ==================================================================
// calcAttendanceScheme
// ==================================================================
describe("calcAttendanceScheme", () => {
  const base = {
    type: "attendance" as const,
    config: {
      full_fee: 100000,
      standard_minutes: 600, // 10h shift
      overtime: { enabled: true, rate_per_hour: 12000 },
      incentives: [
        { name: "Kehadiran", condition: "always", amount: 5000 },
        { name: "Ontime", condition: "ontime_only", amount: 10000 },
      ],
    },
  };

  it("pays full base + both incentives for a full on-time day", () => {
    const res = calcAttendanceScheme(env(base), [
      { rider_id: "R1", log_date: "2026-07-01", duration_minutes: 600, is_late: false, is_absent: false },
    ]);
    expect(res.perRow[0].base).toBe(100000);
    expect(res.perRow[0].incentive).toBe(15000);
    expect(res.perRow[0].overtime).toBe(0);
    expect(res.perRow[0].fee).toBe(115000);
  });

  it("pro-rates base by worked minutes and drops the ontime incentive when late", () => {
    const res = calcAttendanceScheme(env(base), [
      { rider_id: "R1", log_date: "2026-07-01", duration_minutes: 300, is_late: true, is_absent: false },
    ]);
    expect(res.perRow[0].base).toBe(50000); // 100000 * 300/600
    expect(res.perRow[0].incentive).toBe(5000); // only "always"
  });

  it("computes overtime for minutes beyond the standard shift", () => {
    const res = calcAttendanceScheme(env(base), [
      { rider_id: "R1", log_date: "2026-07-01", duration_minutes: 720, is_late: false, is_absent: false },
    ]);
    // (720-600)/60 * 12000 = 24000 ; base capped at full (proportion min 1)
    expect(res.perRow[0].base).toBe(100000);
    expect(res.perRow[0].overtime).toBe(24000);
  });

  it("pays nothing for an absent day and counts it", () => {
    const res = calcAttendanceScheme(env(base), [
      { rider_id: "R1", log_date: "2026-07-01", duration_minutes: 0, is_absent: true },
    ]);
    expect(res.perRow[0].fee).toBe(0);
    expect(res.absentRows).toBe(1);
    expect(res.perRider[0].daysWorked).toBe(0);
  });
});

// ==================================================================
// calcHybridScheme (daily + ontime + per-order)
// ==================================================================
describe("calcHybridScheme", () => {
  const e = env({
    type: "combined",
    config: {
      full_fee: 100000,
      standard_minutes: 600,
      ontime_bonus: 20000,
      order_by: "distance",
      order_tier: stepTier(0, [{ from: 0, to: null, step: 1, add_per_step: 1000 }]),
    },
  });

  it("combines daily (pro-rated) + ontime bonus + per-order fee", () => {
    const deliveries = [
      row({ rider_id: "R1", delivery_date: "2026-07-01", distance_km: 4 }),
      row({ rider_id: "R1", delivery_date: "2026-07-01", distance_km: 6 }),
    ];
    const logs = [
      { rider_id: "R1", log_date: "2026-07-01", duration_minutes: 600, is_late: false, is_absent: false },
    ];
    const res = calcHybridScheme(e, deliveries, logs);
    const line = res.perRider.find((r) => r.rider === "R1")!;
    expect(line.daily_base).toBe(100000); // full day
    expect(line.ontime_bonus).toBe(20000); // ontime
    expect(line.per_order).toBe(4000 + 6000); // 4km + 6km @1000
    expect(line.total).toBe(130000);
    // subtotal equals sum of per-rider totals
    expect(res.subtotal).toBe(130000);
  });

  it("warns and skips daily fee when there is no attendance data", () => {
    const res = calcHybridScheme(e, [row({ rider_id: "R1", distance_km: 5 })], []);
    expect(res.warnings.some((w) => w.includes("absensi"))).toBe(true);
    const line = res.perRider[0];
    expect(line.daily_base).toBe(0);
    expect(line.per_order).toBe(5000); // per-order still paid
  });
});

// ==================================================================
// modular_v2 — flat per-kolom/delivery-type TANPA Distance/Weight
// (regression: Wicked Pies — rate_by="delivery_type" nyantol gak kepake
// kalau dua dimensi dimatiin, karena rate_by/rates cuma dibaca dari dalam
// band Distance/Weight)
// ==================================================================
describe("calcScheme — modular_v2 rate_by tanpa dimensi", () => {
  const modularEnv = (rate_by: "column" | "delivery_type", rates: { key: string; rate: number }[], match_column = "Area") =>
    env({
      type: "modular_v2",
      config: {
        distance: null,
        weight: null,
        rate_by,
        match_column,
        rates,
        unit_basis: "awb",
      } as never,
    });

  it("delivery_type: DELIVERY dan RETURN dapet tarif beda walau Distance/Weight off", () => {
    const e = modularEnv("delivery_type", [
      { key: "DELIVERY", rate: 25000 },
      { key: "RETURN", rate: 10000 },
    ]);
    const res = calcScheme(e, [
      row({ rider_id: "R1", delivery_type: "DELIVERY" }),
      row({ rider_id: "R1", delivery_type: "RETURN" }),
    ]);
    expect(res.perRow[0].fee).toBe(25000);
    expect(res.perRow[1].fee).toBe(10000);
  });

  it("delivery_type: RETURN flat + DELIVERY fallback ke tarif per-area (rates campur)", () => {
    // Kasus nyata: admin mau RETURN kena flat, DELIVERY biasa kena tarif
    // per-district — dua-duanya digabung dalam 1 rates list, match_column
    // "Area" diabaikan selama rate_by masih "delivery_type". Match delivery_type
    // dulu (ketemu buat RETURN), fallback ke district kalau row-nya DELIVERY.
    const e = modularEnv("delivery_type", [
      { key: "KOTA JAKARTA BARAT", rate: 14000 },
      { key: "RETURN", rate: 15000 },
    ]);
    const res = calcScheme(e, [
      row({ rider_id: "R1", delivery_type: "DELIVERY", district: "Jakarta Barat" }),
      row({ rider_id: "R1", delivery_type: "RETURN", district: "Jakarta Barat" }),
    ]);
    expect(res.perRow[0].fee).toBe(14000); // DELIVERY -> fallback match district (prefix-insensitive)
    expect(res.perRow[1].fee).toBe(15000); // RETURN -> match delivery_type langsung
  });

  it("column: rate per Area walau Distance/Weight off", () => {
    const e = modularEnv("column", [{ key: "Jakarta Pusat", rate: 12000 }], "Area");
    const res = calcScheme(e, [row({ rider_id: "R1", district: "Jakarta Pusat" })]);
    expect(res.perRow[0].fee).toBe(12000);
  });

  it("rate_by flat tanpa dimensi tetap 0 (gak ada base fee buat di-apply)", () => {
    const e = modularEnv("column", []);
    (e.config as { rate_by: string }).rate_by = "flat";
    const res = calcScheme(e, [row({ rider_id: "R1" })]);
    expect(res.perRow[0].fee).toBe(0);
  });

  // Regression: Noovoleum Cleaning — district aktual ("Bandung") gak match
  // rate table manapun (isinya nama Jabodetabek) → dulu diam-diam Rp0 tanpa
  // jejak. Sekarang jatuh ke default_rate + kewarning di calcScheme.warnings.
  it("column: district gak match rate manapun jatuh ke default_rate, bukan diam-diam 0", () => {
    const e = modularEnv("column", [{ key: "Jakarta Pusat", rate: 12000 }], "Area");
    (e.config as { default_rate: number }).default_rate = 8000;
    const res = calcScheme(e, [row({ rider_id: "R1", district: "Bandung" })]);
    expect(res.perRow[0].fee).toBe(8000);
    expect(res.warnings.some((w) => w.includes("gak ke-match"))).toBe(true);
  });

  it("column: default_rate 0/gak diisi tetap 0 buat district gak match (gak ubah perilaku lama kalau emang gak dipakai)", () => {
    const e = modularEnv("column", [{ key: "Jakarta Pusat", rate: 12000 }], "Area");
    const res = calcScheme(e, [row({ rider_id: "R1", district: "Bandung" })]);
    expect(res.perRow[0].fee).toBe(0);
    expect(res.warnings.some((w) => w.includes("gak ke-match"))).toBe(true);
  });
});

// ==================================================================
// modular_v2 — rate_by="delivery_type" DENGAN Distance+Weight dua-duanya aktif
// (regression: Wicked Pies client-revenue scheme — Return kena dobel-charge
// kalau distance & weight sama-sama jatuh ke band flat yang match override,
// dan Return jauh/berat malah lolos dari override kalau bandnya "tier".
// Config di bawah adalah config Wicked Pies · Rider · Per Pengiriman asli.)
// ==================================================================
describe("calcScheme — modular_v2 rate_by=delivery_type + Distance & Weight aktif bareng", () => {
  const wickedPiesRevenueEnv = () =>
    env({
      type: "modular_v2",
      config: {
        rate_by: "delivery_type",
        match_column: "Area",
        rates: [{ key: "Return", rate: 12000 }],
        unit_basis: "awb",
        default_rate: 0,
        distance: {
          enabled: true,
          accumulate: "per_order",
          rows: [
            { type: "flat", from: 0, to: 5, base_fee: 12000, step: 0, add_per_step: 0 },
            { type: "tier", from: 5, to: 1000, base_fee: 12000, step: 1, add_per_step: 2000 },
          ],
        },
        weight: {
          mode: "range",
          enabled: true,
          accumulate: "per_order",
          rows: [
            { type: "flat", from: 0, to: 20, base_fee: 0, step: 0, add_per_step: 0 },
            { type: "tier", from: 20, to: 100, base_fee: 0, step: 1, add_per_step: 2000 },
          ],
        },
      } as never,
    });

  it("Return deket & ringan (dua dimensi jatuh ke band flat) dihitung SEKALI, bukan dobel", () => {
    const e = wickedPiesRevenueEnv();
    const res = calcScheme(e, [row({ rider_id: "R1", delivery_type: "RETURN", distance_km: 3, weight_kg: 5 })]);
    expect(res.perRow[0].fee).toBe(12000); // bukan 24000 (12rb distance + 12rb weight)
  });

  it("Return jauh (band distance jadi tier) tetap kena flat Return, bukan rumus tier delivery biasa", () => {
    const e = wickedPiesRevenueEnv();
    const res = calcScheme(e, [row({ rider_id: "R1", delivery_type: "RETURN", distance_km: 50, weight_kg: 5 })]);
    expect(res.perRow[0].fee).toBe(12000); // bukan 12000 + 45*2000 = 102000
  });

  it("Return berat (band weight jadi tier) tetap kena flat Return, bukan rumus tier delivery biasa", () => {
    const e = wickedPiesRevenueEnv();
    const res = calcScheme(e, [row({ rider_id: "R1", delivery_type: "RETURN", distance_km: 3, weight_kg: 50 })]);
    expect(res.perRow[0].fee).toBe(12000); // bukan 0 + 30*2000 = 60000
  });

  it("DELIVERY biasa (gak match rate table) tetap jalan normal lewat band Distance+Weight dijumlah", () => {
    const e = wickedPiesRevenueEnv();
    const res = calcScheme(e, [row({ rider_id: "R1", delivery_type: "DELIVERY", distance_km: 3, weight_kg: 5 })]);
    expect(res.perRow[0].fee).toBe(12000); // distance flat 12000 (gak match "Return") + weight flat 0
  });

  it("DELIVERY jauh & berat tetap dihitung tier per dimensi seperti biasa (gak ketutup override)", () => {
    const e = wickedPiesRevenueEnv();
    const res = calcScheme(e, [row({ rider_id: "R1", delivery_type: "DELIVERY", distance_km: 50, weight_kg: 50 })]);
    // distance: 12000 + 45*2000 = 102000; weight: 0 + 30*2000 = 60000
    expect(res.perRow[0].fee).toBe(162000);
  });
});

// ==================================================================
// modular_v2 — weight_surcharge: berat lewat batas -> fee Distance dikali N
// ==================================================================
describe("calcScheme — modular_v2 weight_surcharge (Distance dikali N kalau berat lewat batas)", () => {
  const distanceOnlyEnv = (weight_surcharge: { enabled: boolean; threshold_kg: number; multiplier: number } | null) =>
    env({
      type: "modular_v2",
      config: {
        rate_by: "flat",
        match_column: "Area",
        rates: [],
        unit_basis: "awb",
        default_rate: 0,
        weight_surcharge,
        distance: {
          enabled: true,
          accumulate: "per_order",
          rows: [{ type: "flat", from: 0, to: 1000, base_fee: 10000, step: 0, add_per_step: 0 }],
        },
        weight: null,
      } as never,
    });

  it("berat di bawah batas: fee Distance normal, gak kena kali", () => {
    const e = distanceOnlyEnv({ enabled: true, threshold_kg: 20, multiplier: 2 });
    const res = calcScheme(e, [row({ rider_id: "R1", distance_km: 3, weight_kg: 15 })]);
    expect(res.perRow[0].fee).toBe(10000);
  });

  it("berat PAS di batas (>=) ikut kena kali", () => {
    const e = distanceOnlyEnv({ enabled: true, threshold_kg: 20, multiplier: 2 });
    const res = calcScheme(e, [row({ rider_id: "R1", distance_km: 3, weight_kg: 20 })]);
    expect(res.perRow[0].fee).toBe(20000);
  });

  it("berat lewat batas: fee Distance dikali multiplier", () => {
    const e = distanceOnlyEnv({ enabled: true, threshold_kg: 20, multiplier: 2 });
    const res = calcScheme(e, [row({ rider_id: "R1", distance_km: 3, weight_kg: 25 })]);
    expect(res.perRow[0].fee).toBe(20000);
  });

  it("mati (enabled:false): berat berapapun gak ngaruh ke fee Distance", () => {
    const e = distanceOnlyEnv({ enabled: false, threshold_kg: 20, multiplier: 2 });
    const res = calcScheme(e, [row({ rider_id: "R1", distance_km: 3, weight_kg: 999 })]);
    expect(res.perRow[0].fee).toBe(10000);
  });

  it("weight_surcharge null (skema lama belum punya field ini): tetap jalan normal", () => {
    const e = distanceOnlyEnv(null);
    const res = calcScheme(e, [row({ rider_id: "R1", distance_km: 3, weight_kg: 999 })]);
    expect(res.perRow[0].fee).toBe(10000);
  });

  it("Weight dimension aktif TERPISAH tetap dihitung normal, gak ikut kena kali — cuma pemicu", () => {
    const e = env({
      type: "modular_v2",
      config: {
        rate_by: "flat",
        match_column: "Area",
        rates: [],
        unit_basis: "awb",
        default_rate: 0,
        weight_surcharge: { enabled: true, threshold_kg: 20, multiplier: 2 },
        distance: {
          enabled: true,
          accumulate: "per_order",
          rows: [{ type: "flat", from: 0, to: 1000, base_fee: 10000, step: 0, add_per_step: 0 }],
        },
        weight: {
          mode: "range",
          enabled: true,
          accumulate: "per_order",
          rows: [{ type: "flat", from: 0, to: 1000, base_fee: 5000, step: 0, add_per_step: 0 }],
        },
      } as never,
    });
    const res = calcScheme(e, [row({ rider_id: "R1", distance_km: 3, weight_kg: 25 })]);
    // distance 10000*2 (kena kali, berat lewat batas) + weight 5000 (normal, gak ikut kali)
    expect(res.perRow[0].fee).toBe(25000);
  });
});

// ==================================================================
// billing_addons — regression: calcAttendanceScheme/calcHybridScheme dulu
// gak pernah nerapin billing_addons sama sekali (min_charge/admin_fee/ppn),
// walau form ngasih toggle-nya buat scheme_for="client" di kategori manapun.
// ==================================================================
describe("billing_addons diterapkan di semua kategori", () => {
  const billing = { min_charge: 0, admin_fee_flat: 5000, ppn_percent: 10 };

  it("calcAttendanceScheme: subtotal + admin_fee, lalu ×(1+ppn%)", () => {
    const e = env({
      type: "attendance",
      billing_addons: billing,
      config: { full_fee: 100000, standard_minutes: 480 },
    });
    const res = calcAttendanceScheme(e, [
      { rider_id: "R1", log_date: "2026-07-01", duration_minutes: 480, is_late: false, is_absent: false },
    ]);
    expect(res.subtotal).toBe(100000);
    // (100000 + 5000) * 1.10 = 115500
    expect(res.grandTotal).toBe(115500);
    expect(res.billing?.admin_fee).toBe(5000);
  });

  it("calcHybridScheme: billing_addons juga diterapkan ke grandTotal", () => {
    const e = env({
      type: "combined",
      billing_addons: billing,
      config: { full_fee: 100000, standard_minutes: 480, ontime_bonus: 0, order_by: "distance", order_tier: null },
    });
    const res = calcHybridScheme(
      e,
      [row({ rider_id: "R1", distance_km: 0 })],
      [{ rider_id: "R1", log_date: "2026-07-01", duration_minutes: 480, is_late: false, is_absent: false }],
    );
    expect(res.subtotal).toBe(100000);
    expect(res.grandTotal).toBe(115500);
  });
});
