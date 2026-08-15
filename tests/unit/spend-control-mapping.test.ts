import { describe, expect, it } from "vitest";
import { resolveBusinessUnit } from "@/lib/spend-control-mapping";

describe("resolveBusinessUnit", () => {
  it("maps the scheduled revenue stream", () => {
    expect(resolveBusinessUnit(["SCHEDULED_INSTANT"])).toBe("SCHEDULED_INSTANT");
  });

  it("maps the cross-dock revenue stream", () => {
    expect(resolveBusinessUnit(["X_DOCK"])).toBe("X_DOCK");
  });

  it("prioritizes scheduled when a provider has both streams", () => {
    expect(resolveBusinessUnit(["X_DOCK", "SCHEDULED_INSTANT"])).toBe("SCHEDULED_INSTANT");
  });

  it("excludes providers with no supported revenue stream", () => {
    expect(resolveBusinessUnit([])).toBeNull();
    expect(resolveBusinessUnit(["ON_DEMAND"])).toBeNull();
  });
});
