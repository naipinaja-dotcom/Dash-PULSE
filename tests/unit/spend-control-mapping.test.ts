import { describe, expect, it } from "vitest";
import { resolveBusinessUnit } from "@/lib/spend-control-mapping";

describe("resolveBusinessUnit", () => {
  // Nilai balik harus persis enum businessUnit API Spend Control (§11 guide),
  // bukan nama internal revenueStreams kita — lihat spend-control-mapping.ts.
  it("maps the scheduled revenue stream", () => {
    expect(resolveBusinessUnit(["SCHEDULED_INSTANT"])).toBe("SCHEDULED");
  });

  it("maps the cross-dock revenue stream", () => {
    expect(resolveBusinessUnit(["X_DOCK"])).toBe("XDOCK");
  });

  it("prioritizes scheduled when a provider has both streams", () => {
    expect(resolveBusinessUnit(["X_DOCK", "SCHEDULED_INSTANT"])).toBe("SCHEDULED");
  });

  it("excludes providers with no supported revenue stream", () => {
    expect(resolveBusinessUnit([])).toBeNull();
    expect(resolveBusinessUnit(["ON_DEMAND"])).toBeNull();
  });
});
