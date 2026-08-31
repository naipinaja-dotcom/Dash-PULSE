import { describe, it, expect } from "vitest";
import { matchesRunTime } from "@/lib/payroll-workflow.server";

// Regression buat bug "cutoff hari ini data ordernya gak lengkap": cron
// live-fee-sync-15min pakai matchesRunTime(nowMinutesOfDay + 30, runTime)
// buat nentuin kapan tiap client di-sync — 30 menit sebelum run_time-nya.
// Kasus nyata: Otts and Jill run_time 16:30, sync fixed lama jam 16:00 gak
// nyampe (gap 30 menit). Test ini pastiin offset +30 match PAS jam 16:00,
// dan gak match di luar toleransi ±7 menit.
function syncShouldFireAt(hhmm: string, runTime: string): boolean {
  const [h, m] = hhmm.split(":").map(Number);
  return matchesRunTime(h * 60 + m + 30, runTime);
}

describe("live-fee-sync gateByRunTime (30 menit sebelum run_time)", () => {
  it("sync jam 16:00 match run_time 16:30 (kasus Otts and Jill)", () => {
    expect(syncShouldFireAt("16:00", "16:30")).toBe(true);
  });

  it("sync jam 12:30 match run_time 13:00 (kasus Wicked Pies)", () => {
    expect(syncShouldFireAt("12:30", "13:00")).toBe(true);
  });

  it("gak match kalau masih di luar toleransi ±7 menit", () => {
    expect(syncShouldFireAt("15:30", "16:30")).toBe(false);
    expect(syncShouldFireAt("16:15", "16:30")).toBe(false);
  });

  it("run_time null default ke 09:00", () => {
    expect(syncShouldFireAt("08:30", null as unknown as string)).toBe(true);
  });
});
