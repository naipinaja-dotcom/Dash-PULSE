import { describe, it, expect } from "vitest";
import { resolveFee } from "@/lib/sync-live-deliveries";
import type { LiveDeliveryRow } from "@/lib/api/live-fee-deliveries.functions";

// Regression: "Tarik dari API" di Cek Data (raw-data-only, sengaja gak
// ngitung fee) manggil upsertLiveDeliveries() TANPA feeByDashId. Karena
// replace_live_deliveries itu DELETE+INSERT penuh (bukan upsert parsial),
// fee baris LAMA yang udah ke-Hitung-Fee/di-commit ikut kehapus & diganti
// default 0 — payroll yang udah Finalize/Publish jadi Rp0 begitu di-Generate
// Ulang (kasus nyata: GORECA). resolveFee harus PERTAHANKAN fee lama kalau
// caller gak ngasih feeByDashId, bukan nge-reset ke 0.
function row(overrides: Partial<LiveDeliveryRow> = {}): LiveDeliveryRow {
  return {
    status: "COMPLETED",
    dash_delivery_id: "DSH-1",
    provider_order_id: null,
    ...overrides,
  } as LiveDeliveryRow;
}

describe("resolveFee", () => {
  it("caller gak ngasih feeByDashId sama sekali -> pakai fee lama (bukan 0)", () => {
    const existing = new Map([["dash:DSH-1", 45000]]);
    expect(resolveFee(row(), undefined, existing)).toBe(45000);
  });

  it("caller ngasih feeByDashId yang ADA buat baris ini -> fee baru menang", () => {
    const existing = new Map([["dash:DSH-1", 45000]]);
    const fresh = new Map([["DSH-1", 50000]]);
    expect(resolveFee(row(), fresh, existing)).toBe(50000);
  });

  it("caller ngasih feeByDashId tapi baris ini gak ada di situ -> tetap pakai fee lama", () => {
    const existing = new Map([["dash:DSH-1", 45000]]);
    const fresh = new Map([["DSH-OTHER", 50000]]);
    expect(resolveFee(row(), fresh, existing)).toBe(45000);
  });

  it("baris benar-benar baru (gak ada fee lama tersimpan) -> 0, bukan undefined/crash", () => {
    expect(resolveFee(row({ dash_delivery_id: "DSH-NEW" }), undefined, new Map())).toBe(0);
  });

  it("match by provider_order_id kalau dash_delivery_id kosong", () => {
    const existing = new Map([["provider:PRV-9", 12000]]);
    expect(
      resolveFee(row({ dash_delivery_id: null, provider_order_id: "PRV-9" }), undefined, existing),
    ).toBe(12000);
  });
});
