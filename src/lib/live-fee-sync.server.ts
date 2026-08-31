// Live Fee Auto-Sync — cron 2x/hari yang mengotomasi persis apa yang admin
// lakukan manual di "Hitung Fee" (lihat syncToDb/syncAttToDb di
// admin.calculate.tsx): tarik data LIVE dari mgmt API dashelectric per client
// yang (a) sudah di-link ke provider (clients.provider_id) DAN (b) ada di
// "daftar reminder" aktif (payroll_reminder_schedules) — hitung fee pakai
// skema pricing client itu, simpan ke delivery_records/attendance_logs.
//
// Jadwal produksi (lihat 20260730000001_live_fee_sync_cron.sql) kirim {from,to}
// EKSPLISIT untuk satu hari kalender per run — bukan rolling window — supaya
// tiap hari cuma dihitung ULANG persis 2x: sekali sebagai "H-0" (hari itu
// sendiri, jam 16:00 WIB) dan sekali lagi besoknya sebagai "H-1" (jam 12:00
// WIB, saat datanya udah pasti final). defaultWindow() di bawah cuma fallback
// kalau {from,to} gak dikirim (mis. trigger manual tanpa param).
// SENGAJA TIDAK bikin payroll_runs di sini (dulu pernah, dicabut lagi —
// window rolling 2 hari cron ini gak nyambung sama periode gajian mingguan
// per-client, bikin draft run kedua yang salah scope). Payroll run tetap
// sepenuhnya urusan payroll-workflow.server.ts yang jalan setelahnya,
// baca dari delivery_records/attendance_logs yang barusan di-sync di sini.
//
// Kenapa perlu file terpisah (bukan reuse createServerFn di
// src/lib/api/live-fee-*.functions.ts apa adanya): fungsi-fungsi itu
// mensyaratkan sesi admin login (assertAuth cek JWT user) dan nulis pakai
// client anon (kena RLS) — cron gak punya keduanya. Endpoint cron ini sendiri
// sudah dilindungi secret header (lihat api.live-fee-sync.ts), jadi di sini
// langsung pakai getSupabaseAdmin() (service role) + panggil inti fetch yang
// sudah dipisah dari assertAuth (fetchLiveDeliveries/fetchLiveAttendance/
// fetchApiProviders).
//
// Client<->provider linkage: dibaca dari clients.provider_id (kolom baru,
// lihat migration 20260730000000_clients_provider_id.sql) — BUKAN name-match
// runtime seperti di admin.calculate.tsx, karena cron gak punya daftar
// clients+providers di memori UI buat dicocokkan.
//
// PENTING: provider_id cuma nandain "client ini BISA di-live-sync" — bukan
// "client ini HARUS diproses tiap cron jalan". "Sync dari API" (admin.clients.tsx)
// nge-link provider_id ke SEMUA client yang namanya match provider di mgmt API
// (bisa puluhan), jadi scoping tambahan wajib ada: cuma client yang punya baris
// aktif di payroll_reminder_schedules (level-client, rider_id null) — "daftar
// reminder" yang sama dipakai payroll-workflow.server.ts buat nentuin client
// mana yang payroll-nya beneran mau diurus terjadwal — yang diproses cron ini.
// Client dengan provider_id tapi TANPA baris reminder aktif dilewati diam-diam.
import { getSupabaseAdmin } from "./supabase-admin.server";
import { getServerConfig } from "./config.server";
import { normalize } from "./pricing-store";
import { pickPricingScheme } from "./pnl-engine";
import { calcScheme, calcAttendanceScheme } from "./pricing-calc";
import { fetchApiProviders, type ApiProvider } from "./api/providers.functions";
import { fetchLiveDeliveries } from "./api/live-fee-deliveries.functions";
import { fetchLiveAttendance } from "./api/live-fee-attendance.functions";
import { upsertLiveDeliveries } from "./sync-live-deliveries";
import { upsertLiveAttendance } from "./sync-live-attendance";
import { matchesRunTime, nowInWib } from "./payroll-workflow.server";

type SupabaseAdmin = ReturnType<typeof getSupabaseAdmin>;

// Fallback kalau {from,to} gak dikirim (mis. trigger manual tanpa param):
// rolling 8 hari (kalender Asia/Jakarta) — bukan coba pas-in ke batas periode
// payroll (itu urusan payroll-workflow yang jalan setelahnya). Overlap
// antar-run aman karena upsertLiveDeliveries/upsertLiveAttendance idempotent
// (dedup by dash id / overwrite by date range).
// ponytail: dulu 2 hari, kegores kasus client dengan batch mingguan (mis.
// Jumat-Senin) — order-nya baru "muncul" (COMPLETED) di mgmt API pas batch
// ditutup Senin, tapi delivery_date-nya balik ke Jumat; window 2 hari selalu
// mepet Senin doang jadi Jumat-nya kebuang permanen di filter delivery_date
// (lihat inPeriod di live-fee-deliveries.functions.ts). 8 hari = 2x siklus
// mingguan terpanjang yang ada sekarang (Jumat-Senin, 4 hari) — kalau ada
// client dengan siklus lebih panjang lagi, lebarin lagi angkanya di sini.
const JKT_OFFSET_MS = 7 * 60 * 60 * 1000;
const SYNC_WINDOW_DAYS = 8;
function jktToday(): string {
  return new Date(Date.now() + JKT_OFFSET_MS).toISOString().slice(0, 10);
}
function defaultWindow(): { from: string; to: string } {
  const to = jktToday();
  const fromDt = new Date(`${to}T00:00:00Z`);
  fromDt.setUTCDate(fromDt.getUTCDate() - SYNC_WINDOW_DAYS);
  return { from: fromDt.toISOString().slice(0, 10), to };
}

interface ClientRow {
  id: string;
  name: string;
  provider_id: number | null;
}

export interface LiveFeeSyncClientResult {
  client_id: string;
  client_name: string;
  category: string | null;
  delivery?: { fetched: number; inserted: number; overwritten: number };
  attendance?: { fetched: number; inserted: number };
  error?: string;
}

export interface LiveFeeSyncResult {
  from: string;
  to: string;
  clientsChecked: number;
  clientsSynced: number;
  results: LiveFeeSyncClientResult[];
}

async function syncOneClient(
  admin: SupabaseAdmin,
  client: ClientRow,
  provider: ApiProvider,
  dashToken: string,
  schemesRaw: unknown[],
  from: string,
  to: string,
): Promise<LiveFeeSyncClientResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const schemes = (schemesRaw as any[]).map(normalize);
  const scheme = pickPricingScheme(schemes, client.id, "rider");
  const out: LiveFeeSyncClientResult = {
    client_id: client.id,
    client_name: client.name,
    category: scheme?.category ?? null,
  };
  if (!scheme) return out; // client belum punya skema rider aktif — skip diam-diam (sama seperti payroll-workflow)

  const businessUnit = provider.revenueStreams.length === 1 ? provider.revenueStreams[0] : null;
  const label = `Auto-sync ${from}..${to}`;

  if (scheme.category === "attendance") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cfg = scheme.params.config as any;
    const shifts = Array.isArray(cfg?.shifts) ? cfg.shifts : [];
    const live = await fetchLiveAttendance(dashToken, provider.id, from, to, shifts);
    const res = calcAttendanceScheme(scheme.params, live.rows);
    const fees = res.perRow.map((r) => Number(r.fee) || 0);
    const sync = await upsertLiveAttendance(client.id, live.rows, from, to, label, fees, admin);
    out.attendance = { fetched: live.meta.fetched, inserted: sync.inserted };
  } else {
    // "delivery" & legacy "hybrid" (skema hybrid gak lagi ditawarkan baru,
    // tapi yang lama masih harus tetap kehitung — dispatch sama seperti
    // admin.calculate.tsx/pnl-engine.ts) sama-sama sumber datanya dari
    // delivery live; hybrid butuh attendance juga tapi belum dipakai client
    // manapun yang di-link provider hari ini — cukup delivery dulu.
    const live = await fetchLiveDeliveries(dashToken, provider.id, businessUnit, from, to);
    const res = calcScheme(scheme.params, live.rows);
    const feeByDashId = new Map<string, number>(
      res.perRow.filter((r) => r.id).map((r) => [String(r.id), Number(r.fee) || 0]),
    );
    const sync = await upsertLiveDeliveries(client.id, live.rows, label, feeByDashId, admin);
    out.delivery = {
      fetched: live.meta.fetched,
      inserted: sync.inserted,
      overwritten: sync.overwritten,
    };
  }

  // TIDAK bikin/isi payroll_runs di sini — window rolling 2 hari (kemarin+
  // hari ini) gak nyambung sama periode gajian mingguan client (Senin-Minggu
  // dari Reminder Calendar), jadi kalau dipaksa findOrCreatePayrollRun pakai
  // {from,to} di sini bakal bikin draft run KEDUA yang scope-nya salah,
  // terpisah dari run mingguan asli. Payroll run yang bener tetap
  // sepenuhnya urusan payroll-workflow.server.ts (resolvePeriodIfDue),
  // yang bacanya dari delivery_records/attendance_logs yang barusan di-sync.
  return out;
}

export async function runLiveFeeSync(opts: {
  triggeredBy: "cron" | "manual";
  from?: string;
  to?: string;
  // Dipakai cron polling 15-menitan (live-fee-sync-15min): daripada tarik
  // SEMUA client di tiap tick, tiap client cuma diproses pas SEKARANG persis
  // 30 menit sebelum `run_time` custom-nya (matchesRunTime dgn offset +30,
  // sama toleransi ±7 menit dgn payroll-workflow) — biar data delivery/
  // attendance HARI INI selalu fresh pas payroll-workflow baca di run_time-nya,
  // tanpa perlu checkpoint fixed yang harus di-tuning manual tiap ada client
  // baru/run_time beda (root cause bug: sync checkpoint lama ketinggalan
  // 30 menit dari run_time Otts and Jill 16:30 → data cutoff gak lengkap).
  // Default {from,to} kalau gak dikirim = HARI INI (bukan defaultWindow() 8
  // hari — itu cuma buat manual/backfill tanpa gating).
  gateByRunTime?: boolean;
}): Promise<LiveFeeSyncResult> {
  const admin = getSupabaseAdmin();
  const { from, to } = opts.from && opts.to
    ? { from: opts.from, to: opts.to }
    : opts.gateByRunTime
      ? { from: jktToday(), to: jktToday() }
      : defaultWindow();

  const raw = (process.env.DASH_MGMT_API_TOKEN || "").replace(/^\s*Bearer\s+/i, "").trim();
  if (!raw)
    throw new Error("DASH_MGMT_API_TOKEN belum di-set di server — isi di .env lalu restart.");
  const dashToken = `Bearer ${raw}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adminAny = admin as any;
  const [
    { data: clientsRaw, error: cErr },
    providers,
    { data: schemesRaw, error: sErr },
    { data: remindersRaw, error: rErr },
  ] = await Promise.all([
    adminAny
      .from("clients")
      .select("id, name, provider_id")
      .eq("active", true)
      .not("provider_id", "is", null),
    fetchApiProviders(dashToken),
    adminAny
      .from("pricing_schemes")
      .select(
        "id, name, client_id, scheme_for, calc_type, effective_from, effective_to, params, created_at",
      ),
    // "Daftar reminder" — client_id level-client (rider_id null) yang aktif.
    // Ini scoping WAJIB (lihat komentar di atas file) — provider_id doang
    // gak cukup buat nandain client mana yang mau diproses cron ini.
    adminAny
      .from("payroll_reminder_schedules")
      .select("client_id, run_time")
      .eq("active", true)
      .is("rider_id", null)
      .not("client_id", "is", null),
  ]);
  if (cErr) throw new Error(`Gagal ambil clients: ${cErr.message}`);
  if (sErr) throw new Error(`Gagal ambil pricing_schemes: ${sErr.message}`);
  if (rErr) throw new Error(`Gagal ambil payroll_reminder_schedules: ${rErr.message}`);

  const remindedClientIds = new Set(
    (remindersRaw ?? []).map((r: { client_id: string }) => r.client_id),
  );
  // Satu client bisa punya >1 baris reminder (mis. periode ganjil/genap
  // minggu) — masing-masing bisa bawa run_time beda, jadi dikumpulin semua.
  const runTimesByClient = new Map<string, string[]>();
  for (const r of (remindersRaw ?? []) as Array<{ client_id: string; run_time: string | null }>) {
    const arr = runTimesByClient.get(r.client_id) ?? [];
    arr.push(r.run_time ?? "09:00");
    runTimesByClient.set(r.client_id, arr);
  }
  let clients = ((clientsRaw ?? []) as ClientRow[]).filter((c) => remindedClientIds.has(c.id));
  if (opts.gateByRunTime) {
    const wib = nowInWib();
    const nowMinutesOfDay = wib.getUTCHours() * 60 + wib.getUTCMinutes();
    clients = clients.filter((c) =>
      (runTimesByClient.get(c.id) ?? ["09:00"]).some((rt) => matchesRunTime(nowMinutesOfDay + 30, rt)),
    );
  }
  const providerById = new Map(providers.map((p) => [p.id, p]));

  const results: LiveFeeSyncClientResult[] = [];
  for (const client of clients) {
    const provider = client.provider_id != null ? providerById.get(client.provider_id) : undefined;
    if (!provider) {
      results.push({
        client_id: client.id,
        client_name: client.name,
        category: null,
        error: "provider_id tidak ketemu di mgmt API",
      });
      continue;
    }
    try {
      results.push(
        await syncOneClient(admin, client, provider, dashToken, schemesRaw ?? [], from, to),
      );
    } catch (e) {
      results.push({
        client_id: client.id,
        client_name: client.name,
        category: null,
        error: (e as Error).message,
      });
    }
  }

  return {
    from,
    to,
    clientsChecked: clients.length,
    clientsSynced: results.filter((r) => !r.error).length,
    results,
  };
}

export function verifyLiveFeeSyncSecret(headerValue: string | null): boolean {
  const expected = getServerConfig().liveFeeSyncSecret;
  if (!expected) return false;
  return !!headerValue && headerValue === expected;
}
