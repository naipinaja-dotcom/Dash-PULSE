import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { AttendanceLogRow, ShiftConfig } from "@/lib/pricing-calc";
import { findShiftFor } from "@/lib/pricing-calc";

// Sumber data LIVE untuk skema Attendance (Per Kehadiran) di "Hitung Fee" —
// tarik logbook clock-in/out langsung dari mgmt API (endpoint approval), map ke
// AttendanceLogRow. Dipakai client hub/dark-store seperti Alfagift (provider 446).
//
// Endpoint: GET /v1/drivers/log-book/attendance/approval
//   - filter startDate/endDate berdasar clockInAt (pakai x-client-time-zone utk
//     batas hari) → basis "hari kerja" = tanggal clock-in (langsung, tanpa buffer).
//   - providerIDs WAJIB dikirim eksplisit (token tanpa provider → kosong).

const BASE = "https://api.dashelectric.co/v1/drivers/log-book/attendance/approval";
const PAGE_SIZE = 200;
const MAX_WORKERS = 6;
const MAX_PAGES = 60;
const RETRIES = 3;
const JKT_OFFSET_MS = 7 * 60 * 60 * 1000;

type UpstreamRow = Record<string, any>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function assertAuth(token: string) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY belum di-set di server");
  const res = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: key, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Sesi tidak valid — coba login ulang.");
}

/** Hari kalender Asia/Jakarta (YYYY-MM-DD). */
function jktDay(iso: string): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return String(iso).slice(0, 10);
  return new Date(t + JKT_OFFSET_MS).toISOString().slice(0, 10);
}
/** Jam Asia/Jakarta "HH:MM". */
function jktTime(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t + JKT_OFFSET_MS).toISOString().slice(11, 16);
}
/** Menit-dalam-hari (WIB) dari ISO, buat deteksi telat. */
function jktMinutes(iso: string): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const d = new Date(t + JKT_OFFSET_MS);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

function hhmmToMinutes(t: string): number {
  const [h, m] = t.split(":").map((x) => parseInt(x, 10));
  return (h || 0) * 60 + (m || 0);
}

// Fallback kalibrasi Alfagift (dipakai HANYA kalau client belum setup shift +
// "Batas Ontime" (late_after) di skema attendance-nya sama sekali): shift pagi
// mulai 06:00, shift siang mulai 14:00, toleransi 10 menit.
const FALLBACK_MORNING_START = 6 * 60; // 06:00
const FALLBACK_AFTERNOON_START = 14 * 60; // 14:00
const FALLBACK_LATE_TOLERANCE_MIN = 10;
const FALLBACK_AFTERNOON_CUTOFF = 10 * 60; // clock-in >= 10:00 dianggap shift siang

// Config-driven per-client (shift.late_after dari skema attendance client itu,
// sama sumbernya dengan yang dipakai calcAttendanceComponent) — cuma jatuh ke
// kalibrasi Alfagift kalau client belum setup shift/late_after sama sekali,
// supaya client selain Alfagift (mis. hasil auto-sync ke banyak client
// sekaligus) gak ikut kena jam Alfagift secara keliru.
function isLateClockIn(iso: string, shifts: ShiftConfig[]): boolean {
  const m = jktMinutes(iso);
  if (m == null) return false;
  const clockInHHMM = jktTime(iso);
  if (clockInHHMM && shifts.length > 0) {
    const shift = findShiftFor(clockInHHMM, shifts);
    if (shift?.late_after) return m > hhmmToMinutes(shift.late_after);
  }
  const start = m < FALLBACK_AFTERNOON_CUTOFF ? FALLBACK_MORNING_START : FALLBACK_AFTERNOON_START;
  return m > start + FALLBACK_LATE_TOLERANCE_MIN;
}

async function apiGet(
  token: string,
  providerId: number,
  from: string,
  to: string,
  page: number,
): Promise<any> {
  const q = new URLSearchParams({
    page: String(page),
    size: String(PAGE_SIZE),
    startDate: from,
    endDate: to,
    providerIDs: String(providerId),
    driverTypes: "RIDER,DRIVER",
  });
  const url = `${BASE}?${q.toString()}`;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Authorization: token, "x-client-time-zone": "Asia/Jakarta" },
      });
      if (res.ok) return await res.json();
      if (res.status === 401) throw new Error("Token mgmt API ditolak / kadaluarsa (401)");
      if (![408, 429, 500, 502, 503, 504].includes(res.status))
        throw new Error(`Attendance API error ${res.status}`);
      lastErr = new Error(`Attendance API error ${res.status}`);
    } catch (e) {
      if ((e as Error).message.includes("401")) throw e;
      lastErr = e;
    }
    await sleep(600 * (attempt + 1));
  }
  throw lastErr ?? new Error("Gagal memanggil Attendance API");
}

// Superset AttendanceLogRow + field buat tampilan/sync.
export interface LiveAttendanceRow extends AttendanceLogRow {
  clock_out: string | null;
  client_name: string | null;
  driver_name: string | null;
  approval_type: string | null;
  pitstop_name: string | null;
}

function toAttendanceRow(x: UpstreamRow, shifts: ShiftConfig[]): LiveAttendanceRow {
  const inISO = x.clockInAt ?? "";
  const outISO = x.clockOutAt ?? null;
  const inT = Date.parse(inISO);
  const outT = outISO ? Date.parse(outISO) : NaN;
  const duration =
    !Number.isNaN(inT) && !Number.isNaN(outT) ? Math.max(0, Math.round((outT - inT) / 60000)) : null;
  return {
    id: x.logBookID ?? null, // id upstream, bukan uuid attendance_logs
    rider_id: null, // diresolusi di client (by driver_code)
    driver_code: x.driverCode || null,
    log_date: jktDay(inISO),
    clock_in: jktTime(inISO),
    clock_out: jktTime(outISO),
    duration_minutes: duration,
    // Telat dihitung dari clock-in vs jam mulai shift (bonus kehadiran ontime-only).
    is_late: isLateClockIn(inISO, shifts),
    is_absent: false, // record yang ada = hadir; yang absen tidak muncul di API
    client_name: x.clientNames ?? null,
    driver_name: (x.driverName ?? "").trim() || null,
    approval_type: x.approvalType ?? null,
    // Nama dark-store/pitstop (mis. "Dark Store Alfagift - Ujung Aspal") — dipetakan
    // dari x.hubNames, sebelumnya kebuang begitu aja padahal ada di raw response.
    pitstop_name: x.hubNames ?? null,
  };
}

export interface LiveFeeAttendanceResult {
  rows: LiveAttendanceRow[];
  meta: {
    provider_id: number;
    fetched: number; // total shift ditarik dari API
    matched: number; // shift di periode (termasuk ongoing)
    ongoing: number; // di antara matched, yang belum clock-out (durasi 0, cuma bonus)
    pending: number; // di antara matched, yang approval PENDING
    from: string;
    to: string;
  };
}

// Inti tarik+map — dipisah dari createServerFn supaya bisa dipanggil dari cron
// (src/lib/live-fee-sync.server.ts), yang gak punya sesi admin login buat
// lolos assertAuth dan udah dilindungi secret header-nya sendiri. `dashToken`
// sudah termasuk prefix "Bearer ". `shifts` = config shift skema attendance
// client itu (buat is_late per late_after — lihat isLateClockIn di atas).
export async function fetchLiveAttendance(
  dashToken: string,
  providerId: number,
  from: string,
  to: string,
  shifts: ShiftConfig[] = [],
): Promise<LiveFeeAttendanceResult> {
  if (from > to) throw new Error("Tanggal 'dari' tidak boleh setelah 'sampai'");

  const first = await apiGet(dashToken, providerId, from, to, 1);
  const upstream: UpstreamRow[] = [...(first?.data?.data ?? [])];
  const pg = first?.data?.pagination ?? {};
  const last = Math.min(pg.lastPage ?? pg.last_page ?? 1, MAX_PAGES);

  if (last > 1) {
    const pages: number[] = [];
    for (let p = 2; p <= last; p++) pages.push(p);
    const got: Record<number, UpstreamRow[]> = {};
    let idx = 0;
    const worker = async () => {
      while (idx < pages.length) {
        const p = pages[idx++];
        const d = await apiGet(dashToken, providerId, from, to, p);
        got[p] = d?.data?.data ?? [];
      }
    };
    await Promise.all(Array.from({ length: Math.min(MAX_WORKERS, pages.length) }, worker));
    for (const p of Object.keys(got).map(Number).sort((a, b) => a - b)) upstream.push(...got[p]);
  }

  // Semua shift yang log_date-nya di periode — TERMASUK yang masih "ongoing"
  // (belum clock-out). Yang ongoing: durasi 0 (daily_base 0) tapi tetap
  // dihitung "hadir" → dapat bonus kehadiran flat, sama persis dengan perilaku
  // upload CSV (yang juga memasukkan baris ongoing). Kalau dibuang, total fee
  // kurang sebesar (jumlah ongoing × bonus).
  const rows = upstream
    .map((x) => toAttendanceRow(x, shifts))
    .filter((r) => r.log_date >= from && r.log_date <= to);
  const ongoing = rows.filter((r) => !r.clock_out).length;
  const pending = rows.filter((r) => r.approval_type === "PENDING").length;

  return {
    rows,
    meta: {
      provider_id: providerId,
      fetched: upstream.length,
      matched: rows.length,
      ongoing,
      pending,
      from,
      to,
    },
  };
}

export const loadLiveFeeAttendance = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      token: z.string().min(1),
      providerId: z.number().int().positive(),
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal 'dari' tidak valid"),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal 'sampai' tidak valid"),
      shifts: z.array(z.any()).optional(), // ShiftConfig[] skema attendance client (buat late_after)
    }),
  )
  .handler(async ({ data }): Promise<LiveFeeAttendanceResult> => {
    await assertAuth(data.token);

    const raw = (process.env.DASH_MGMT_API_TOKEN || "").replace(/^\s*Bearer\s+/i, "").trim();
    if (!raw) throw new Error("DASH_MGMT_API_TOKEN belum di-set di server — isi di .env lalu restart.");
    const token = `Bearer ${raw}`;

    return fetchLiveAttendance(token, data.providerId, data.from, data.to, (data.shifts as ShiftConfig[]) ?? []);
  });
