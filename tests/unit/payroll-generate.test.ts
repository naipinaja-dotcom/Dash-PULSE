import { describe, it, expect } from "vitest";
import { monthsClosedOutBy } from "@/lib/payroll-generate";

// Regression: BPJS Alfagift kepotong 2x pas periode mingguan nabrak
// pergantian bulan (24-30 Agu lalu 31 Agu-6 Sep dianggap 2 bulan beda).
// monthsClosedOutBy nentuin bulan mana yang BENERAN "ditutup" sama sebuah
// periode (ngelewatin tgl>=28), dipakai buat dedup "monthly_once" (BPJS)
// di generatePayrollDetails.
describe("monthsClosedOutBy", () => {
  it("run yang seluruhnya di tengah bulan gak nutup bulan manapun", () => {
    expect(monthsClosedOutBy("2026-08-01", "2026-08-07")).toEqual([]);
    expect(monthsClosedOutBy("2026-08-24", "2026-08-27")).toEqual([]);
  });

  it("run yang nyampe tgl>=28 nutup bulan itu", () => {
    expect(monthsClosedOutBy("2026-08-24", "2026-08-30")).toEqual(["2026-08"]);
  });

  it("run yang numpang lewat pergantian bulan nutup bulan LAMA, bukan bulan baru (kasus Alfagift)", () => {
    expect(monthsClosedOutBy("2026-08-31", "2026-09-06")).toEqual(["2026-08"]);
  });

  it("run bulan Februari (28 hari) tetap ke-detect", () => {
    expect(monthsClosedOutBy("2026-02-23", "2026-03-01")).toEqual(["2026-02"]);
  });

  it("run yang bener2 mulai tgl 1 bulan baru gak nutup bulan lama", () => {
    expect(monthsClosedOutBy("2026-09-01", "2026-09-07")).toEqual([]);
  });

  it("periode panjang (>1 bulan) bisa nutup lebih dari 1 bulan", () => {
    expect(monthsClosedOutBy("2026-07-25", "2026-08-29")).toEqual(["2026-07", "2026-08"]);
  });
});
