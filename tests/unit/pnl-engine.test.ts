import { describe, expect, it } from "vitest";
import { pickPricingScheme, computePnl } from "@/lib/pnl-engine";
import type { PricingScheme } from "@/lib/pricing-types";

function scheme(over: Partial<PricingScheme>): PricingScheme {
  return {
    id: over.id ?? "id",
    name: "s",
    client_id: null,
    client_name: null,
    scheme_for: "client",
    category: "delivery",
    subtype: null,
    effective_from: "2026-01-01",
    effective_to: null,
    params: { version: 1 } as PricingScheme["params"],
    created_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

describe("pickPricingScheme", () => {
  it("prefers the newer of two overlapping client-specific schemes (GORECA regression)", () => {
    const stale = scheme({ id: "stale", client_id: "goreca", effective_from: "2026-07-18", created_at: "2026-07-18T00:00:00Z" });
    const correct = scheme({ id: "correct", client_id: "goreca", effective_from: "2026-07-19", created_at: "2026-07-19T00:00:00Z" });
    const picked = pickPricingScheme([stale, correct], "goreca", "client");
    expect(picked?.id).toBe("correct");
  });

  it("ignores a scheme whose effective_from is still in the future", () => {
    const active = scheme({ id: "active", client_id: "goreca", effective_from: "2026-07-01" });
    const future = scheme({ id: "future", client_id: "goreca", effective_from: "2099-01-01" });
    const picked = pickPricingScheme([active, future], "goreca", "client");
    expect(picked?.id).toBe("active");
  });

  it("ignores an expired scheme (effective_to in the past)", () => {
    const expired = scheme({ id: "expired", client_id: "goreca", effective_from: "2020-01-01", effective_to: "2020-12-31" });
    const current = scheme({ id: "current", client_id: "goreca", effective_from: "2026-01-01" });
    const picked = pickPricingScheme([expired, current], "goreca", "client");
    expect(picked?.id).toBe("current");
  });

  it("still prefers a client-specific scheme over a catch-all one", () => {
    const catchAll = scheme({ id: "all", client_id: null, effective_from: "2026-07-19" });
    const specific = scheme({ id: "specific", client_id: "goreca", effective_from: "2026-01-01" });
    const picked = pickPricingScheme([catchAll, specific], "goreca", "client");
    expect(picked?.id).toBe("specific");
  });

  // Regression: audit — pickPricingScheme dulu SELALU filter ke "hari ini"
  // (Date.now() di dalam fungsi), gak bisa dikasih tau lagi ngitung buat
  // periode historis mana. Backfill/rerun laporan minggu lama jadi kepilih
  // skema yang aktif HARI JOB-NYA DIJALANIN, bukan yang berlaku pas minggu itu.
  it("asOfDate menentukan skema mana yang berlaku, BUKAN tanggal panggil fungsi (backfill regression)", () => {
    const oldRate = scheme({ id: "old-rate", client_id: "goreca", effective_from: "2026-01-01", effective_to: "2026-06-30" });
    const newRate = scheme({ id: "new-rate", client_id: "goreca", effective_from: "2026-07-01" });
    // Backfill buat periode Maret 2026 — skema yang berlaku SAAT ITU adalah
    // old-rate, walau new-rate udah aktif kalau dicek "hari ini" (default).
    const picked = pickPricingScheme([oldRate, newRate], "goreca", "client", "2026-03-15");
    expect(picked?.id).toBe("old-rate");
  });
});

// ==================================================================
// computePnl — regression: client MURNI attendance (nol delivery_records,
// mis. Alfagift) sebelumnya gak pernah muncul di perClient sama sekali
// (grouping dulu cuma dari delivery_records), DAN kalaupun dipaksa muncul,
// selalu dihitung calcScheme (engine delivery) yang balikin 0 buat
// env.type="attendance" — dua bug sekaligus.
// ==================================================================
describe("computePnl — client attendance murni (Alfagift regression)", () => {
  const clients = [{ id: "alfagift", name: "Alfagift" }];

  const clientScheme = scheme({
    id: "alfagift-client", client_id: "alfagift", scheme_for: "client", category: "attendance",
    params: { version: 1, type: "attendance", add_kg: null, multi_drop: null, billing_addons: null,
      config: { full_fee: 200000, standard_minutes: 480, incentives: [] } } as PricingScheme["params"],
  });
  const riderScheme = scheme({
    id: "alfagift-rider", client_id: "alfagift", scheme_for: "rider", category: "attendance",
    params: { version: 1, type: "attendance", add_kg: null, multi_drop: null, billing_addons: null,
      config: { full_fee: 100000, standard_minutes: 480, incentives: [{ amount: 40000, condition: "ontime_only" }] } } as PricingScheme["params"],
  });

  const attendanceRows = [
    { rider_id: "R1", client_name: "Alfagift", log_date: "2026-07-01", duration_minutes: 480, is_late: false, is_absent: false },
    { rider_id: "R2", client_name: "Alfagift", log_date: "2026-07-01", duration_minutes: 480, is_late: false, is_absent: false },
  ];

  it("client shows up in perClient even with ZERO delivery_records", () => {
    const { perClient } = computePnl([], [clientScheme, riderScheme], clients, attendanceRows);
    expect(perClient).toHaveLength(1);
    expect(perClient[0].clientId).toBe("alfagift");
  });

  it("dispatches to calcAttendanceScheme (not calcScheme, which would give 0)", () => {
    const { perClient } = computePnl([], [clientScheme, riderScheme], clients, attendanceRows);
    const c = perClient[0];
    expect(c.revenue).toBe(400000); // 2 rider-hari x full_fee 200000
    expect(c.cost).toBe(280000); // 2 x (100000 + insentif ontime 40000)
    expect(c.margin).toBe(120000);
  });

  it("attendance_logs.client_name di-cocokkan ke clients.name (bukan client_id — kolomnya emang gak ada)", () => {
    const mismatched = attendanceRows.map((r) => ({ ...r, client_name: "Nama Beda" }));
    const { perClient } = computePnl([], [clientScheme, riderScheme], clients, mismatched);
    // gak match client manapun -> masuk bucket "(tanpa client)", bukan "alfagift"
    expect(perClient.find((c) => c.clientId === "alfagift")).toBeUndefined();
    expect(perClient.find((c) => c.clientId === "(tanpa client)")).toBeDefined();
  });
});
