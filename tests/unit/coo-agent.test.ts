import { describe, it, expect } from "vitest";
import { CooAnalysisSchema } from "@/lib/agents/coo-agent";

// Regression: audit — runCooAgent() dulu cast langsung `result as CooAnalysis`
// dari respons Hermes tanpa dicek sama sekali. JSON valid tapi bentuknya salah
// (mis. top_concerns bukan array) lolos begitu aja, baru crash belakangan pas
// dirender/dikirim ke Slack/Email dengan pesan error yang gak jelas asalnya.
describe("CooAnalysisSchema", () => {
  const valid = {
    headline: "Minggu ini stabil",
    top_concerns: [{ concern: "Margin Otts and Jill turun", severity: "HIGH", reason: "Cost naik" }],
    top_actions: [{ rank: 1, action: "Renegosiasi rate", owner: "Ops", roi: "Rp5jt/bulan", approve: "YES" }],
    coo_brief: "Ringkasan eksekutif.",
  };

  it("nerima bentuk yang bener", () => {
    expect(CooAnalysisSchema.safeParse(valid).success).toBe(true);
  });

  it("nolak kalau top_concerns bukan array (contoh persis dari audit)", () => {
    const malformed = { ...valid, top_concerns: "tidak ada masalah" };
    expect(CooAnalysisSchema.safeParse(malformed).success).toBe(false);
  });

  it("nolak severity/approve di luar enum yang diperbolehkan", () => {
    const malformed = { ...valid, top_actions: [{ ...valid.top_actions[0], approve: "MAYBE" }] };
    expect(CooAnalysisSchema.safeParse(malformed).success).toBe(false);
  });

  it("nolak field wajib yang hilang", () => {
    const { headline: _headline, ...rest } = valid;
    expect(CooAnalysisSchema.safeParse(rest).success).toBe(false);
  });
});
