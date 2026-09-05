import { describe, it, expect } from "vitest";
import { describeScheme } from "@/lib/rate-card";
import type { PricingScheme, PricingEnvelope } from "@/lib/pricing-types";

function scheme(params: PricingEnvelope, extra: Partial<PricingScheme> = {}): PricingScheme {
  return {
    id: "s1",
    name: "Skema Uji",
    client_id: null,
    client_name: null,
    scheme_for: "rider",
    calc_type: params.type,
    effective_from: "2026-07-01",
    effective_to: null,
    params,
    created_at: "2026-07-01T00:00:00Z",
    ...extra,
  };
}

const baseEnv = (type: PricingEnvelope["type"], config: Record<string, unknown>): PricingEnvelope => ({
  version: 1,
  type,
  config,
  add_kg: null,
  multi_drop: null,
  billing_addons: null,
  area_city_pricing: null,
});

describe("describeScheme", () => {
  it("renders a human-readable label and name", () => {
    const card = describeScheme(scheme(baseEnv("flat_unit", { rate_by: "flat", flat_rate: 10000 })));
    expect(card.schemeName).toBe("Skema Uji");
    expect(card.calcLabel).toBe("Flat per Unit");
    expect(card.calcType).toBe("flat_unit");
  });

  it("flat_unit flat: shows the flat rate formatted in rupiah", () => {
    const card = describeScheme(scheme(baseEnv("flat_unit", { rate_by: "flat", flat_rate: 10000 })));
    const allRows = card.sections.flatMap((s) => s.rows);
    expect(allRows.some((r) => r.rate === "Rp10.000")).toBe(true);
  });

  it("flat_unit table: lists each keyed rate plus a default row", () => {
    const card = describeScheme(
      scheme(
        baseEnv("flat_unit", {
          rate_by: "table",
          match_column: "district",
          rates: [{ key: "JAKARTA", rate: 5000 }],
          default_rate: 3000,
        }),
      ),
    );
    const vars = card.sections.flatMap((s) => s.rows).map((r) => r.variable);
    expect(vars).toContain("JAKARTA");
    expect(vars.some((v) => v.includes("default"))).toBe(true);
  });

  it("tier: emits distance and weight sections", () => {
    const card = describeScheme(
      scheme(
        baseEnv("tier", {
          distance: { base_fee: 5000, base_until: 2, tiers: [{ from: 2, to: null, step: 1, add_per_step: 1000 }] },
          weight: { base_fee: 0, base_until: 0, tiers: [] },
        }),
      ),
    );
    const titles = card.sections.map((s) => s.title);
    expect(titles.some((t) => t?.includes("jarak"))).toBe(true);
    expect(titles.some((t) => t?.includes("berat"))).toBe(true);
  });

  it("appends modifier sections (add_kg / multi_drop / billing)", () => {
    const env = baseEnv("flat_unit", { rate_by: "flat", flat_rate: 10000 });
    env.add_kg = { enabled: true, tier: { base_fee: 0, base_until: 0, tiers: [] } };
    env.multi_drop = { fee_per_extra_shipment: 2000 };
    env.billing_addons = { min_charge: 50000, admin_fee_flat: 5000, ppn_percent: 11 };
    const card = describeScheme(scheme(env, { scheme_for: "client", client_name: "Client X" }));
    const titles = card.sections.map((s) => s.title);
    expect(titles).toContain("Surcharge berat (Add-KG)");
    expect(titles).toContain("Multi-drop");
    expect(titles).toContain("Billing (tagihan client)");
    expect(card.clientName).toBe("Client X");
  });

  it("degrades gracefully for an unknown scheme type", () => {
    const card = describeScheme(scheme(baseEnv("bogus" as PricingEnvelope["type"], {})));
    const allRows = card.sections.flatMap((s) => s.rows);
    expect(allRows.some((r) => r.variable.includes("belum dikenali"))).toBe(true);
  });
});
