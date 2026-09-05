import { describe, expect, it } from "vitest";
import { buildDeliveryConfig, emptyDeliveryState } from "@/components/pricing-form/delivery-fields";
import { sanitizeDecimalInput, sanitizeTimeInput } from "@/components/pricing-form/shared";
import { computeInteractive, defaultCalcInputs, type InteractiveCalcProps } from "@/components/pricing-form/interactive-calc";
import { emptyAttendanceState } from "@/components/pricing-form/attendance-fields";
import { emptyAreaCityState } from "@/components/pricing-form/area-city-fields";

describe("sanitizeDecimalInput", () => {
  it("replaces comma with dot (ID keyboards type decimals with comma)", () => {
    expect(sanitizeDecimalInput("10,5")).toBe("10.5");
  });

  it("keeps only the first dot when the user types more than one punctuation mark", () => {
    expect(sanitizeDecimalInput("10.1.2")).toBe("10.12");
    expect(sanitizeDecimalInput("10,1,2")).toBe("10.12");
  });

  it("strips non-numeric characters", () => {
    expect(sanitizeDecimalInput("10km")).toBe("10");
  });
});

describe("sanitizeTimeInput", () => {
  it("auto-inserts the colon as digits are typed (no AM/PM, always 24h)", () => {
    expect(sanitizeTimeInput("0")).toBe("0");
    expect(sanitizeTimeInput("06")).toBe("06");
    expect(sanitizeTimeInput("061")).toBe("06:1");
    expect(sanitizeTimeInput("0610")).toBe("06:10");
  });

  it("clamps hour to 23 and minute to 59", () => {
    expect(sanitizeTimeInput("9999")).toBe("23:59");
  });

  it("ignores non-digit characters (e.g. pasted 'AM'/'PM')", () => {
    expect(sanitizeTimeInput("06:10 AM")).toBe("06:10");
  });
});

describe("buildDeliveryConfig", () => {
  it("saves the Distance dimension when the checkbox is on, even if the stale internal enabled flag never flipped (GORECA regression)", () => {
    const state = emptyDeliveryState();
    // Meniru persis apa yang kejadian di form: user centang Distance (subtype),
    // isi baris tarif di tabel (rows) — tapi state.distance.enabled tetap
    // default false karena gak ada UI yang nyentuh field itu.
    state.distance.rows = [{ type: "flat", from: "0", to: "12", base_fee: "15000", step: "0", add_per_step: "0" }];

    const config = buildDeliveryConfig({ distance: true, weight: false }, state);

    expect(config.distance).not.toBeNull();
    // Ini persis yang lolos sebelumnya: gerbang luar (null vs objek) udah bener,
    // tapi enabled DI DALAM objeknya sendiri (yang beneran dibaca pricing-calc.ts)
    // masih ikutan state.distance.enabled yang basi kalau gak dites eksplisit.
    expect(config.distance?.enabled).toBe(true);
    expect(config.distance?.rows[0].base_fee).toBe(15000);
    expect(config._dims).toEqual({ distance: true, weight: false });
  });

  it("still saves null when the checkbox is off", () => {
    const state = emptyDeliveryState();
    state.distance.rows = [{ type: "flat", from: "0", to: "12", base_fee: "15000", step: "0", add_per_step: "0" }];

    const config = buildDeliveryConfig({ distance: false, weight: false }, state);

    expect(config.distance).toBeNull();
    expect(config._dims).toEqual({ distance: false, weight: false });
  });
});

describe("computeInteractive (pricing scheme preview calculator)", () => {
  // Komu Komu Bakehouse's real client scheme: rate_by="delivery_type" with
  // only a "Return" override configured, Distance bands 0-7km flat / 7.1km+
  // tiered. A normal delivery order never matches "Return", so its price
  // should move with km — before the fix, the preview locked to the first
  // configured rate key ("Return") regardless of rate_by, always hitting the
  // override and making Distance look like it did nothing.
  it("prices by the Distance band, not the unrelated Return override, for a normal delivery", () => {
    const state = emptyDeliveryState();
    state.rate_by = "delivery_type";
    state.rates = [{ key: "Return", rate: "25000" }];
    state.distance.rows = [
      { type: "flat", from: "0", to: "7", base_fee: "25000", step: "0", add_per_step: "0" },
      { type: "tier", from: "7.1", to: "100", base_fee: "25000", step: "1", add_per_step: "2000" },
    ];

    const props: InteractiveCalcProps = {
      category: "delivery",
      subtype: { distance: true, weight: false },
      delivery: state,
      attendance: emptyAttendanceState(),
      schemeFor: "client",
      addKgOn: false,
      multiDropOn: false,
      multiDropFee: "0",
      areaCityOn: false,
      areaCity: emptyAreaCityState(),
      billingOn: false,
    };

    const near = computeInteractive(props, { ...defaultCalcInputs(props), distance: "5" });
    const far = computeInteractive(props, { ...defaultCalcInputs(props), distance: "10" });

    expect(near.total.amount).toBe(25000); // flat band [0-7)
    expect(far.total.amount).toBe(31000); // tier band: 25000 + ceil((10-7.1)/1) * 2000
    expect(far.total.amount).not.toBe(near.total.amount);
  });
});
