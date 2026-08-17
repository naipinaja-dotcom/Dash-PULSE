import { describe, expect, it } from "vitest";
import { resolvePeriodIfDue, nowInWib, matchesRunTime } from "@/lib/payroll-workflow.server";

describe("resolvePeriodIfDue", () => {
  it("default weekly Senin(1)-Minggu(0): jatuh tempo pas hari ini Senin", () => {
    // 2026-07-20 = Senin
    expect(resolvePeriodIfDue(new Date("2026-07-20T01:00:00Z"), 1, 0)).toEqual({
      periodStart: "2026-07-13",
      periodEnd: "2026-07-19",
    });
  });

  it("default weekly: belum jatuh tempo di hari lain", () => {
    // 2026-07-22 = Rabu, kemarin (Selasa) bukan Minggu -> belum jatuh tempo
    expect(resolvePeriodIfDue(new Date("2026-07-22T10:00:00Z"), 1, 0)).toBeNull();
  });

  it("custom Selasa(2)-Kamis(4): jatuh tempo pas hari ini Jumat (kemarin Kamis)", () => {
    // 2026-07-16 = Kamis -> hari ini 2026-07-17 (Jumat)
    expect(resolvePeriodIfDue(new Date("2026-07-17T01:00:00Z"), 2, 4)).toEqual({
      periodStart: "2026-07-14", // Selasa
      periodEnd: "2026-07-16", // Kamis
    });
  });

  it("custom Jumat(5)-Senin(1) wrap-around minggu: jatuh tempo pas hari ini Selasa (kemarin Senin)", () => {
    // 2026-07-20 = Senin -> hari ini 2026-07-21 (Selasa)
    expect(resolvePeriodIfDue(new Date("2026-07-21T01:00:00Z"), 5, 1)).toEqual({
      periodStart: "2026-07-17", // Jumat
      periodEnd: "2026-07-20", // Senin (4 hari: Jum,Sab,Min,Sen)
    });
  });

  it("Wicked Pies: dua periode beda gak saling nabrak dalam 1 minggu", () => {
    const tueThu = { start: 2, end: 4 };
    const friMon = { start: 5, end: 1 };
    // Kamis (2026-07-16) -> jatuh tempo Selasa-Kamis di hari Jumat (2026-07-17)
    expect(resolvePeriodIfDue(new Date("2026-07-17T00:00:00Z"), tueThu.start, tueThu.end)).toEqual({
      periodStart: "2026-07-14",
      periodEnd: "2026-07-16",
    });
    // Fri-Mon belum jatuh tempo di hari yang sama
    expect(resolvePeriodIfDue(new Date("2026-07-17T00:00:00Z"), friMon.start, friMon.end)).toBeNull();
  });

  it("closeSameDay=true: Selasa(2)-Kamis(4) jatuh tempo PAS hari Kamis itu sendiri (bukan besoknya)", () => {
    // 2026-07-16 = Kamis
    expect(resolvePeriodIfDue(new Date("2026-07-16T10:00:00Z"), 2, 4, true)).toEqual({
      periodStart: "2026-07-14", // Selasa
      periodEnd: "2026-07-16", // Kamis (hari ini)
    });
  });

  it("closeSameDay=true: belum jatuh tempo sehari sebelumnya (Rabu)", () => {
    // 2026-07-15 = Rabu
    expect(resolvePeriodIfDue(new Date("2026-07-15T10:00:00Z"), 2, 4, true)).toBeNull();
  });

  it("closeSameDay=false (default) tetap nunggu besok walau endWeekday match hari ini", () => {
    // 2026-07-16 = Kamis — dengan closeSameDay default (false), harusnya BELUM
    // jatuh tempo hari ini, baru besok (Jumat).
    expect(resolvePeriodIfDue(new Date("2026-07-16T10:00:00Z"), 2, 4)).toBeNull();
  });
});

describe("nowInWib", () => {
  it("menggeser jam 00:00-06:59 WIB (yang di UTC masih 'kemarin') ke tanggal WIB yang benar", () => {
    // 2026-08-18T01:00:00 WIB = 2026-08-17T18:00:00Z (UTC masih Senin 17, WIB udah Selasa 18)
    const wib = nowInWib(new Date("2026-08-17T18:00:00Z"));
    expect(wib.getUTCDate()).toBe(18);
    expect(wib.getUTCDay()).toBe(2); // Selasa
  });

  it("jam yang gak nyebrang batas hari tetap konsisten (cuma jam-nya yang geser +7)", () => {
    const wib = nowInWib(new Date("2026-08-17T02:00:00Z")); // 09:00 WIB, masih Senin di dua-duanya
    expect(wib.getUTCDate()).toBe(17);
    expect(wib.getUTCHours()).toBe(9);
  });
});

describe("matchesRunTime", () => {
  const toMinutes = (h: number, m: number) => h * 60 + m;

  it("cocok kalau sekarang PAS di jam target", () => {
    expect(matchesRunTime(toMinutes(9, 0), "09:00")).toBe(true);
  });

  it("cocok dalam toleransi 7 menit ke tick 15-menit terdekat", () => {
    // Target 07:32 -> tick 07:30 (selisih 2) yang match, tick 07:45 (selisih 13) enggak
    expect(matchesRunTime(toMinutes(7, 30), "07:32")).toBe(true);
    expect(matchesRunTime(toMinutes(7, 45), "07:32")).toBe(false);
  });

  it("gak cocok kalau di luar toleransi", () => {
    expect(matchesRunTime(toMinutes(10, 0), "09:00")).toBe(false);
  });

  it("null/kosong pakai default 09:00", () => {
    expect(matchesRunTime(toMinutes(9, 0), null)).toBe(true);
    expect(matchesRunTime(toMinutes(14, 0), null)).toBe(false);
  });

  it("wrap-around lewat tengah malam (target 23:55, sekarang 00:00)", () => {
    expect(matchesRunTime(toMinutes(0, 0), "23:55")).toBe(true);
  });

  it("format run_time yang gak valid fallback ke default 09:00 (gak crash)", () => {
    expect(matchesRunTime(toMinutes(9, 0), "bukan-jam")).toBe(true);
  });

  it("run_time lolos regex tapi rentangnya invalid (mis. menit 99) di-clamp, bukan bikin diff negatif", () => {
    // Tanpa clamp: target = 23*60+99 = 1479 (overflow, di luar 0-1439). Di
    // jam 00:10 (n=10), diff mentah = |10-1479| = 1469, 1440-1469 = -29,
    // min(1469,-29) = -29 <= 7 -> match SALAH (harusnya jauh dari target).
    // Dengan clamp, target jadi 23:59 (1439), diff = 1429, 1440-1429 = 11,
    // 11 <= 7 salah -> gak match, sesuai ekspektasi.
    expect(matchesRunTime(toMinutes(0, 10), "23:99")).toBe(false);
    // Ter-clamp jadi 23:59 -> tetap match kalau sekarang emang di sekitar 23:59.
    expect(matchesRunTime(toMinutes(23, 58), "23:99")).toBe(true);
  });
});
