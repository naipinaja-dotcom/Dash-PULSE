import { describe, it, expect, vi, afterEach } from "vitest";
import { defaultWeekRange } from "@/lib/pnl-weekly-push.server";

// Regression: audit ditemukan cron Senin 00:00 UTC (07:00 WIB) yang lama
// pakai rolling 7-hari-trailing dari "sekarang" — nyangkut separuh Senin ini
// (datanya kosong) dan ngelewatin Senin minggu lalu. Fix-nya harus selalu
// balikin minggu kalender (Senin-Minggu) yang BENERAN udah kelar, apapun hari
// dia dipanggil (cron Senin, atau tombol manual di hari lain).
describe("defaultWeekRange", () => {
  afterEach(() => vi.useRealTimers());

  it("dipanggil Senin 00:00 UTC (kasus cron asli) -> minggu Senin-Minggu yang baru kelar, BUKAN nyangkut Senin hari ini", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T00:00:00Z")); // Senin
    expect(defaultWeekRange()).toEqual({ weekStart: "2026-08-10", weekEnd: "2026-08-16" });
  });

  it("dipanggil Rabu (kasus tombol manual) -> minggu Senin-Minggu SEBELUMNYA yang udah kelar, bukan minggu berjalan", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-12T10:00:00Z")); // Rabu
    expect(defaultWeekRange()).toEqual({ weekStart: "2026-08-03", weekEnd: "2026-08-09" });
  });

  it("dipanggil hari Minggu -> minggu HARI INI belum dianggap kelar, mundur ke minggu sebelumnya", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-16T05:00:00Z")); // Minggu
    expect(defaultWeekRange()).toEqual({ weekStart: "2026-08-03", weekEnd: "2026-08-09" });
  });
});
