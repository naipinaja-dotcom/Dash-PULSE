// Helper murni yang dipakai BARENG oleh payroll-workflow.server.ts dan
// live-fee-sync.server.ts — diekstrak ke sini (bukan salah satu file itu)
// biar gak ada circular import: payroll-workflow.server.ts sekarang juga
// import syncOneClient/ClientRow dari live-fee-sync.server.ts (buat force
// re-sync sebelum generate payroll — lihat komentar di runPayrollWorkflow),
// jadi kalau helper ini masih "tinggal" di salah satu dari dua file itu,
// yang satu lagi bakal import balik dari situ -> siklus. payroll-workflow.
// server.ts tetap re-export ketiganya biar importer lama (tests, dst.) yang
// `import { nowInWib, matchesRunTime } from "@/lib/payroll-workflow.server"`
// gak perlu ganti path.

// `new Date()` mentahan itu instant UTC — kalau dibaca langsung pake
// getUTCDate()/getUTCDay(), jam 00:00-06:59 WIB itu MASIH tanggal/hari
// KEMARIN di UTC (WIB = UTC+7). Cron cuma dulu aman karena jam-jamnya
// (02:00 & 09:00 UTC) kebetulan gak pernah nyebrang batas hari UTC vs WIB —
// begitu ditambah checkpoint 01:00/06:00 WIB (= 18:00/23:00 UTC HARI
// SEBELUMNYA), atau begitu di-poll tiap 15 menit sepanjang hari (nyentuh
// jendela itu tiap malam), baca UTC mentah bakal salah hari. Geser instant-nya
// +7 jam dulu SEBELUM dibaca — setelah itu getUTCDate()/getUTCDay()/
// getUTCHours() dari hasil geseran ini merepresentasikan tanggal/jam WIB yang
// benar (trik standar buat "baca tanggal lokal" tanpa Intl/timezone lib).
export function nowInWib(rawNow: Date = new Date()): Date {
  return new Date(rawNow.getTime() + 7 * 60 * 60 * 1000);
}

// Cron pengecekan jalan tiap 15 menit (00:00, 00:15, 00:30, ...) — tiap
// tick, cek apakah jam SEKARANG (WIB) lagi paling dekat sama jam custom yang
// di-set client (`run_time`, format "HH:MM", default "09:00" kalau kosong).
// Toleransi 7 menit (bukan 15) SENGAJA dipilih supaya PAS SATU tick yang
// match per target (jarak antar tick 15 menit, jadi tiap target cuma masuk
// jendela ±7 menit dari SATU tick terdekat) — toleransi 15 penuh bakal bikin
// 2 tick sekaligus match & proses dobel (aman sih karena findOrCreatePayrollRun
// idempotent, tapi buang-buang kerjaan).
export function matchesRunTime(
  nowMinutesOfDay: number,
  runTime: string | null,
  toleranceMinutes = 7,
): boolean {
  const [rawH, rawM] = (runTime && /^\d{1,2}:\d{2}$/.test(runTime) ? runTime : "09:00")
    .split(":")
    .map(Number);
  // Clamp: regex hanya cek format, bukan rentang (mis. "23:99" lolos regex).
  // Tanpa ini, target bisa >1439 dan bikin `1440 - diff` negatif -> false match di jam manapun.
  const h = Math.min(23, Math.max(0, rawH || 0));
  const m = Math.min(59, Math.max(0, rawM || 0));
  const target = h * 60 + m;
  const diff = Math.abs(nowMinutesOfDay - target);
  return Math.min(diff, 1440 - diff) <= toleranceMinutes; // Math.min(...) buat wrap-around lewat tengah malam
}

// Query awal (clients/schedules/pricing_schemes, dst.) itu prasyarat SEBELUM
// loop per-client bisa mulai sama sekali — gangguan Supabase sesaat (Gateway
// Timeout) di query ini bikin SELURUH tick gagal duluan sebelum sempat tau
// client mana aja yang due, TANPA kesempatan retry dalam invocation yang
// sama. Regresi nyata (2026-09-14): tick 09:00 WIB (persis jendela run_time
// banyak client) kena Gateway Timeout, seluruh batch "Senin" gak keproses
// SAMA SEKALI, dan karena query itu di luar try/catch manapun waktu itu, gak
// ada jejak di payroll_workflow_runs ataupun notif Slack/Email — cuma gap
// kosong yang diam-diam bikin client itu kelewat SEMINGGU PENUH (jadwal
// mingguan gak balik lagi sampe hari yang sama minggu depan). Retry ringan
// di sini nyerap blip beberapa detik SEBELUM sempat gagal.
export async function withTransientRetry<T>(
  fn: () => Promise<T>,
  attempts = 3,
  delayMs = 1500,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}
