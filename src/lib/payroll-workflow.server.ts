// Payroll Workflow (OES AI Workforce — payroll pertama) — cron HARIAN yang
// otomatis: per client aktif YANG UDAH DI-SETUP (punya jadwal periode di
// Reminder Calendar — payroll_reminder_schedules.period_start_weekday/
// period_end_weekday — DAN punya skema harga rider aktif), cek apakah
// periode gajiannya jatuh tempo HARI INI -> bikin/reuse payroll_runs ->
// panggil generatePayrollDetails() (Business Engine, TIDAK diduplikat) ->
// validasi anomali -> AI audit (Hermes, non-critical) -> notif Slack/Email
// -> log 1 row ke payroll_workflow_runs. Client yang belum di-setup jadwal
// atau skema harga DILEWATI SELURUHNYA — gak bikin draft run kosong.
//
// Sengaja SATU file lurus (bukan abstract Worker classes/generic runner) —
// pola yang sama persis dipakai payroll-reminder.server.ts & coo-insight-
// engine.server.ts, dan cuma ada 1 workflow nyata di sini. Kalau nanti beneran
// ada workflow ke-2 (Finance/RCA), baru worth diekstrak jadi shared runner —
// dari 2 contoh nyata jauh lebih gampang generalize drpd nebak dari 1.
//
// Kenapa cron-nya HARIAN (bukan mingguan): dulu semua client diasumsikan
// gajian mingguan Senin-Minggu seragam. Ternyata beda-beda per client — ada
// yang 2x seminggu dengan periode custom (mis. Selasa-Kamis DAN Jumat-Senin).
// Jadi tiap client dicek TIAP HARI: "apakah salah satu periodenya baru aja
// kelar kemarin?" — sama persis pola payroll-reminder.server.ts yang udah
// jalan harian buat kasus serupa (per-client/rider weekdays custom).
//
// Cuma nyentuh payroll_runs berstatus 'draft' — 'finalized'/'published' berarti
// admin udah review/lock manual, jangan ditimpa otomatis.
//
// Publisher (lock + generate payslip) SENGAJA TIDAK ada di sini — itu udah ada
// sebagai tombol "Publish" manual di admin.payroll.tsx (lihat publish() di
// situ), memang harus persetujuan manusia, bukan otomatis.
import { getSupabaseAdmin } from "./supabase-admin.server";
import { getServerConfig } from "./config.server";
import {
  generatePayrollDetails,
  findOrCreatePayrollRun,
  type PayrollRunLite,
} from "./payroll-generate";
import { callHermes } from "./agents/hermes-client.server";
import { sendSlackMessage } from "./notify/slack.server";
import { sendEmail } from "./notify/email.server";
import { fetchAllRows } from "./fetch-all";
import { pickPricingScheme } from "./pnl-engine";
import { normalize } from "./pricing-store";
import type { PricingScheme } from "./pricing-types";
import {
  calcScheme,
  calcAttendanceScheme,
  calcHybridScheme,
  type DeliveryRow,
  type AttendanceLogRow,
} from "./pricing-calc";
import { resolveRiderIdentities } from "./rider-lookup";

type SupabaseAdmin = ReturnType<typeof getSupabaseAdmin>;

export interface ValidationWarning {
  type:
    | "missing_bank_account"
    | "negative_net_pay"
    | "duplicate_period_payment"
    | "unresolved_rider";
  message: string;
}

export interface AuditReport {
  summary: string;
  recommendations: string[];
}

export interface PayrollWorkflowRunResult {
  runId: string;
  clientName: string;
  periodStart: string;
  periodEnd: string;
  detailCount: number;
  totalGross: number;
  totalNet: number;
  warnings: ValidationWarning[];
  audit: AuditReport | null;
  feeAutoComputed: boolean;
  feeSkipReason?: string;
}

interface FeeAutoComputeResult {
  computed: boolean;
  reason?: string;
  rowCount?: number;
  totalFee?: number;
}

export interface PayrollWorkflowResult {
  runs: PayrollWorkflowRunResult[];
  skippedClients: string[]; // "Client (periode)" yang run-nya udah finalized/published, gak disentuh
  runLogId?: string; // id row payroll_workflow_runs (log), diisi setelah insert
}

// 0=Minggu..6=Sabtu (sama seperti kolom weekdays yang udah ada). Default:
// periode dianggap JATUH TEMPO hari ini kalau KEMARIN persis hari
// terakhirnya (endWeekday) — baru dihitung SEHARI SETELAH periode itu
// tutup, karena gak ada cara tau apa datanya udah lengkap di hari itu
// sendiri. Support wrap-around minggu (mis. Jumat->Senin).
//
// closeSameDay=true: dihitung PAS di hari terakhir periode itu sendiri
// (endWeekday === HARI INI, bukan kemarin) — cuma aman kalau ada cutoff
// operasional reliable, dan itu tanggung jawab admin yang nyalain opsi ini
// di Reminder Calendar (lihat komentar migration
// 20260720000003_payroll_period_close_same_day.sql). Amannya di sini
// terjamin dari JADWAL CRON-nya sendiri: cron sore jalan jam 17:00 WIB,
// sama persis sama cutoff yang diasumsikan closeSameDay — bukan dari
// pengecekan jam tambahan di function ini.
export function resolvePeriodIfDue(
  today: Date,
  startWeekday: number,
  endWeekday: number,
  closeSameDay = false,
): { periodStart: string; periodEnd: string } | null {
  const refDay = new Date(today);
  if (!closeSameDay) refDay.setUTCDate(today.getUTCDate() - 1);
  if (refDay.getUTCDay() !== endWeekday) return null;

  const spanDays = ((endWeekday - startWeekday + 7) % 7) + 1;
  const start = new Date(refDay);
  start.setUTCDate(refDay.getUTCDate() - (spanDays - 1));
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { periodStart: fmt(start), periodEnd: fmt(refDay) };
}

// `new Date()` mentahan itu instant UTC — kalau dibaca langsung pake
// getUTCDate()/getUTCDay() (kayak resolvePeriodIfDue di atas), jam 00:00-06:59
// WIB itu MASIH tanggal/hari KEMARIN di UTC (WIB = UTC+7). Cron cuma dulu
// aman karena jam-jamnya (02:00 & 09:00 UTC) kebetulan gak pernah nyebrang
// batas hari UTC vs WIB — begitu ditambah checkpoint 01:00/06:00 WIB (=
// 18:00/23:00 UTC HARI SEBELUMNYA), atau begitu di-poll tiap 15 menit
// sepanjang hari (nyentuh jendela itu tiap malam), baca UTC mentah bakal
// salah hari. Geser instant-nya +7 jam dulu SEBELUM dibaca — setelah itu
// getUTCDate()/getUTCDay()/getUTCHours() dari hasil geseran ini merepresentasikan
// tanggal/jam WIB yang benar (trik standar buat "baca tanggal lokal" tanpa
// Intl/timezone lib).
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
export function matchesRunTime(nowMinutesOfDay: number, runTime: string | null, toleranceMinutes = 7): boolean {
  const [rawH, rawM] = (runTime && /^\d{1,2}:\d{2}$/.test(runTime) ? runTime : "09:00").split(":").map(Number);
  // Clamp: regex hanya cek format, bukan rentang (mis. "23:99" lolos regex).
  // Tanpa ini, target bisa >1439 dan bikin `1440 - diff` negatif -> false match di jam manapun.
  const h = Math.min(23, Math.max(0, rawH || 0));
  const m = Math.min(59, Math.max(0, rawM || 0));
  const target = h * 60 + m;
  const diff = Math.abs(nowMinutesOfDay - target);
  return Math.min(diff, 1440 - diff) <= toleranceMinutes; // Math.min(...) buat wrap-around lewat tengah malam
}

async function loadClientPeriodSchedules(
  admin: SupabaseAdmin,
): Promise<Map<string, { start: number; end: number; closeSameDay: boolean; runTime: string | null }[]>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any)
    .from("payroll_reminder_schedules")
    .select("client_id, period_start_weekday, period_end_weekday, close_same_day, run_time")
    .not("client_id", "is", null)
    .is("rider_id", null) // periode = konsep level-client, bukan per-rider
    .eq("active", true);
  if (error) throw new Error(`Gagal ambil jadwal periode: ${error.message}`);

  const byClient = new Map<string, { start: number; end: number; closeSameDay: boolean; runTime: string | null }[]>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const s of (data ?? []) as any[]) {
    const arr = byClient.get(s.client_id) ?? [];
    // period_start_weekday/period_end_weekday NULL = "reguler Senin–Minggu"
    // (lihat hint di schedule-form-modal.tsx: "Kosongin kalau client ini
    // mingguan Senin–Minggu biasa") — sebelumnya baris NULL ini malah
    // di-exclude total lewat .not("period_start_weekday", "is", null) di
    // query atas, jadi client dengan periode reguler gak PERNAH kepilih sama
    // cron ini walau udah jatuh tempo (bug: PT. Salam Sehat Indonesia dkk
    // gak pernah keproses H-1 walau hari Senin, harusnya due).
    arr.push({
      start: s.period_start_weekday ?? 1, // Senin
      end: s.period_end_weekday ?? 0, // Minggu
      closeSameDay: !!s.close_same_day,
      runTime: s.run_time ?? null, // null = default "09:00" (lihat matchesRunTime)
    });
    byClient.set(s.client_id, arr);
  }
  return byClient;
}

// Otomatis menjalankan langkah "Hitung Fee" (yang tadinya cuma bisa manual
// dari admin.calculate.tsx) untuk 1 client+periode, sebelum generatePayrollDetails
// dipanggil — biar payroll_details yang di-generate cron ini gross_earning-nya
// BENERAN kehitung, bukan 0 karena delivery_records/attendance_logs.fee belum
// pernah disentuh. Pakai persis engine & langkah yang sama dengan commit()
// manual: pickPricingScheme (resolusi skema aktif, sama seperti PNL Push) ->
// calcScheme/calcAttendanceScheme/calcHybridScheme -> tulis fee -> audit log.
// `committed_by` sengaja NULL (beda dari commit manual yang selalu ada user id)
// biar tetap bisa dibedakan di fee_calculation_audit_log siapa yang commit.
async function autoComputeFee(
  admin: SupabaseAdmin,
  schemes: PricingScheme[],
  clientId: string,
  periodStart: string,
  periodEnd: string,
): Promise<FeeAutoComputeResult> {
  const scheme = pickPricingScheme(schemes, clientId, "rider");
  if (!scheme) return { computed: false, reason: "Belum ada skema rider aktif untuk client ini" };

  const isAttendance = scheme.category === "attendance";
  const isHybrid = scheme.category === "hybrid";

  const paramsConfig = scheme.params.config as
    | { delivery_component?: { enabled?: boolean } }
    | undefined;
  const needDelivery = !isAttendance || !!paramsConfig?.delivery_component?.enabled;
  const needAttendance = isAttendance || isHybrid;

  const [deliveryRowsRaw, attRowsRaw] = await Promise.all([
    needDelivery
      ? fetchAllRows<DeliveryRow>(
          (sb, from, to) =>
            sb
              .from("delivery_records")
              .select(
                "id, rider_id, driver_code, delivery_date, awb, district, distance_km, weight_kg, destination_address, service_type, status, delivery_type",
              )
              .eq("client_id", clientId)
              .gte("delivery_date", periodStart)
              .lte("delivery_date", periodEnd)
              .range(from, to),
          1000,
          admin as never,
        )
      : Promise.resolve([]),
    needAttendance
      ? fetchAllRows<AttendanceLogRow>(
          (sb, from, to) =>
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (sb as never as { from: (t: string) => any })
              .from("attendance_logs")
              .select(
                "id, rider_id, driver_code, log_date, clock_in, duration_minutes, is_late, is_absent",
              )
              .eq("client_id", clientId)
              .gte("log_date", periodStart)
              .lte("log_date", periodEnd)
              .range(from, to),
          1000,
          admin as never,
        )
      : Promise.resolve([]),
  ]);

  const { resolvedIdOf } = await resolveRiderIdentities(
    [...deliveryRowsRaw, ...attRowsRaw],
    admin as never,
  );
  const deliveryRows = deliveryRowsRaw.map((r) => ({ ...r, rider_id: resolvedIdOf(r) }));
  const attRows = attRowsRaw.map((r) => ({ ...r, rider_id: resolvedIdOf(r) }));

  let rows: { id?: string | null; fee: number }[];
  let table: "delivery_records" | "attendance_logs";
  if (isHybrid) {
    rows = calcHybridScheme(scheme.params, deliveryRows, attRows).perRow.filter((r) => r.id);
    table = "delivery_records";
  } else if (isAttendance) {
    rows = calcAttendanceScheme(
      scheme.params,
      attRows,
      needDelivery ? deliveryRows : undefined,
    ).perRow.filter((r) => r.id);
    table = "attendance_logs";
  } else {
    rows = calcScheme(scheme.params, deliveryRows).perRow.filter((r) => r.id);
    table = "delivery_records";
  }

  if (rows.length === 0)
    return { computed: false, reason: "Tidak ada baris pengiriman/absensi untuk periode ini" };

  const chunkSize = 100;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);

    const res = await Promise.all(
      chunk.map((r) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (admin as any)
          .from(table)
          .update({ fee: r.fee })
          .eq("id", r.id as string),
      ),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const err = res.find((x: any) => x.error)?.error;
    if (err) throw new Error(`Gagal simpan fee otomatis (${table}): ${err.message}`);
  }

  const totalFee = rows.reduce((s, r) => s + Number(r.fee || 0), 0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: auditErr } = await (admin as any).from("fee_calculation_audit_log").insert({
    action: "commit_payroll",
    client_id: clientId,
    scheme_id: scheme.id,
    scheme_name: scheme.name ?? null,
    scheme_snapshot: scheme.params,
    period_start: periodStart,
    period_end: periodEnd,
    row_count: rows.length,
    total_amount: totalFee,
    calc_table: table,
    affected_row_ids: rows.map((r) => r.id).filter(Boolean),
    committed_by: null,
  });
  if (auditErr)
    console.error("[payroll-workflow] gagal simpan audit log fee otomatis:", auditErr.message);

  return { computed: true, rowCount: rows.length, totalFee };
}

async function validateRun(
  admin: SupabaseAdmin,
  run: PayrollRunLite,
): Promise<{ warnings: ValidationWarning[]; totalGross: number; totalNet: number }> {
  const warnings: ValidationWarning[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: details, error } = await (admin as any)
    .from("payroll_details")
    .select("rider_id, gross_earning, net_pay, riders(full_name, bank_account)")
    .eq("run_id", run.id);
  if (error) throw new Error(`Gagal ambil payroll_details: ${error.message}`);

  let totalGross = 0;
  let totalNet = 0;
  const riderIds: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const d of (details ?? []) as any[]) {
    totalGross += Number(d.gross_earning) || 0;
    totalNet += Number(d.net_pay) || 0;
    riderIds.push(d.rider_id);
    const riderName = d.riders?.full_name ?? d.rider_id;
    if (!d.riders?.bank_account) {
      warnings.push({
        type: "missing_bank_account",
        message: `${riderName} belum punya nomor rekening bank`,
      });
    }
    if (Number(d.net_pay) < 0) {
      warnings.push({
        type: "negative_net_pay",
        message: `${riderName} net pay negatif (${d.net_pay})`,
      });
    }
  }

  // Duplicate payment: rider yang sama juga punya payroll_details di run LAIN
  // dengan periode persis sama (client berbeda run tapi periode sama = resiko
  // dibayar dobel kalau dua-duanya sampai di-publish).
  if (riderIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: otherRuns } = await (admin as any)
      .from("payroll_runs")
      .select("id")
      .eq("period_start", run.period_start)
      .eq("period_end", run.period_end)
      .neq("id", run.id);
    const otherRunIds = (otherRuns ?? []).map((r: { id: string }) => r.id);
    if (otherRunIds.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: dupes } = await (admin as any)
        .from("payroll_details")
        .select("rider_id, riders(full_name)")
        .in("run_id", otherRunIds)
        .in("rider_id", riderIds);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const d of (dupes ?? []) as any[]) {
        warnings.push({
          type: "duplicate_period_payment",
          message: `${d.riders?.full_name ?? d.rider_id} juga muncul di payroll run lain periode yang sama`,
        });
      }
    }
  }

  // Rider yang ada delivery/attendance periode ini tapi rider_id-nya gak
  // ke-resolve sama sekali (driver_code gak match rider manapun) — makanya
  // gak pernah masuk payroll_details, padahal ada aktivitas beneran.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: unresolvedDeliveries } = await (admin as any)
    .from("delivery_records")
    .select("driver_code")
    .is("rider_id", null)
    .not("driver_code", "is", null)
    .gte("delivery_date", run.period_start)
    .lte("delivery_date", run.period_end)
    .eq("client_id", run.client_id ?? undefined);
  const unresolvedCodes = [
    ...new Set((unresolvedDeliveries ?? []).map((r: { driver_code: string }) => r.driver_code)),
  ];
  for (const code of unresolvedCodes) {
    warnings.push({
      type: "unresolved_rider",
      message: `Ada kiriman dengan kode "${code}" yang gak match rider manapun`,
    });
  }

  return { warnings, totalGross, totalNet };
}

async function runAudit(
  run: PayrollRunLite & { clientName: string },
  detailCount: number,
  totalGross: number,
  totalNet: number,
  warnings: ValidationWarning[],
): Promise<AuditReport | null> {
  try {
    const result = await callHermes({
      system:
        "Kamu auditor payroll internal PT. Dash Elektrik. Baca ringkasan run payroll & warning validasi, " +
        'balas HANYA JSON {"summary": string, "recommendations": string[]} dalam Bahasa Indonesia — ' +
        "summary 2-3 kalimat, recommendations actionable & singkat.",
      user: JSON.stringify({
        client: run.clientName,
        period: `${run.period_start} – ${run.period_end}`,
        detailCount,
        totalGross,
        totalNet,
        warnings: warnings.map((w) => w.message),
      }),
      maxTokens: 500,
    });
    const parsed = result as Partial<AuditReport>;
    if (typeof parsed.summary !== "string" || !Array.isArray(parsed.recommendations)) return null;
    return { summary: parsed.summary, recommendations: parsed.recommendations };
  } catch {
    // Non-critical — audit AI gagal (OpenRouter down, dst) BUKAN alasan
    // workflow berhenti. Payroll udah kehitung tetap lanjut ke notif.
    return null;
  }
}

function buildNotification(result: PayrollWorkflowResult): {
  subject: string;
  text: string;
  html: string;
} {
  const { runs, skippedClients } = result;
  const totalWarnings = runs.reduce((s, r) => s + r.warnings.length, 0);
  const today = new Date().toISOString().slice(0, 10);
  const subject = `Payroll Workflow — ${today}`;
  const lines = [`*💸 Payroll Workflow — ${today}*`];
  if (runs.length === 0) {
    lines.push("Gak ada periode yang jatuh tempo hari ini.");
  }
  for (const r of runs) {
    lines.push(
      `• *${r.clientName}* (${r.periodStart} → ${r.periodEnd}) — ${r.detailCount} rider, net Rp${Math.round(r.totalNet).toLocaleString("id-ID")}` +
        (r.warnings.length ? ` (⚠️ ${r.warnings.length} warning)` : ""),
    );
    if (!r.feeAutoComputed) {
      lines.push(
        `  ⚠️ *Fee belum kehitung otomatis* — ${r.feeSkipReason}. Angka di atas BUKAN gaji final, cek manual sebelum publish.`,
      );
    }
    if (r.audit) lines.push(`  _${r.audit.summary}_`);
  }
  if (skippedClients.length)
    lines.push(`Dilewati (udah finalized/published): ${skippedClients.join(", ")}`);
  lines.push(`Total warning: ${totalWarnings}. Cek Payroll Run untuk review sebelum publish.`);
  const text = lines.join("\n");

  const runRows = runs
    .map(
      (r) =>
        `<li><b>${r.clientName}</b> (${r.periodStart} → ${r.periodEnd}) — ${r.detailCount} rider, net Rp${Math.round(r.totalNet).toLocaleString("id-ID")}` +
        (r.warnings.length ? ` (${r.warnings.length} warning)` : "") +
        (!r.feeAutoComputed
          ? `<br/><b style="color:#b8791f">⚠️ Fee belum kehitung otomatis — ${r.feeSkipReason}. Cek manual sebelum publish.</b>`
          : "") +
        (r.audit ? `<br/><i>${r.audit.summary}</i>` : "") +
        `</li>`,
    )
    .join("");
  const html = `
  <div style="font-family:sans-serif;max-width:640px;margin:0 auto">
    <h2>Payroll Workflow — ${today}</h2>
    ${runs.length ? `<ul>${runRows}</ul>` : "<p>Gak ada periode yang jatuh tempo hari ini.</p>"}
    ${skippedClients.length ? `<p>Dilewati (udah finalized/published): ${skippedClients.join(", ")}</p>` : ""}
    <p>Total warning: ${totalWarnings}. Cek halaman Payroll Run untuk review sebelum publish.</p>
    <p style="color:#888;font-size:12px;margin-top:16px">Dikirim otomatis oleh Dash PULSE — Payroll Workflow.</p>
  </div>`;
  return { subject, text, html };
}

export async function runPayrollWorkflow(opts: {
  triggeredBy: "cron" | "manual" | "event";
  triggeredByUserId?: string;
}): Promise<PayrollWorkflowResult> {
  const admin = getSupabaseAdmin();
  // WIB, bukan UTC mentah — lihat komentar nowInWib(). Penting sejak cron
  // ini dipoll tiap 15 menit sepanjang hari (termasuk jendela 00:00-06:59
  // WIB yang secara UTC masih "kemarin").
  const today = nowInWib();
  const nowMinutesOfDay = today.getUTCHours() * 60 + today.getUTCMinutes();
  const startedAt = new Date().toISOString();

  const [{ data: clients, error: clientsErr }, periodsByClient, { data: schemesRaw }] =
    await Promise.all([
      admin.from("clients").select("id, name").eq("active", true),
      loadClientPeriodSchedules(admin),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (admin as any)
        .from("pricing_schemes")
        .select(
          "id, name, client_id, scheme_for, calc_type, effective_from, effective_to, params, created_at",
        ),
    ]);
  if (clientsErr) throw new Error(`Gagal ambil daftar client: ${clientsErr.message}`);
  const schemes: PricingScheme[] = (schemesRaw ?? []).map(normalize);

  const runs: PayrollWorkflowRunResult[] = [];
  const skippedClients: string[] = [];
  let hardError: string | null = null;

  try {
    for (const c of clients ?? []) {
      // Client belum di-setup jadwal (Reminder Calendar) ATAU belum ada skema
      // harga (rider) — jangan auto-bikin payroll run buat client itu sama
      // sekali. findOrCreatePayrollRun INSERT row draft duluan sebelum tau ada
      // aktivitas/skema atau tidak; tanpa guard ini, tiap client aktif (bahkan
      // yang belum pernah disentuh admin) kebagian draft run kosong tiap minggu.
      const clientPeriods = periodsByClient.get(c.id);
      if (!clientPeriods) continue;
      if (!pickPricingScheme(schemes, c.id, "rider")) continue;

      for (const p of clientPeriods) {
        const period = resolvePeriodIfDue(today, p.start, p.end, p.closeSameDay);
        if (!period) continue; // periode ini belum jatuh tempo hari ini
        // run_time cuma buat nge-gate cron polling 15-menitan biar gak numpuk
        // proses di luar jam yang di-set client. Trigger manual/event = admin
        // eksplisit minta "jalanin SEKARANG" — gak masuk akal ikut nunggu jam
        // custom itu juga (sebelumnya ini bikin tombol "Run Workflow Sekarang"
        // kelihatan gak jalan kalau diklik di luar jendela ±7 menit itu).
        if (opts.triggeredBy === "cron" && !matchesRunTime(nowMinutesOfDay, p.runTime)) continue;

        const run = await findOrCreatePayrollRun(
          {
            clientId: c.id,
            clientName: c.name,
            periodStart: period.periodStart,
            periodEnd: period.periodEnd,
          },
          admin as never,
        );
        if (run.status !== "draft") {
          skippedClients.push(`${c.name} (${period.periodStart}–${period.periodEnd})`);
          continue;
        }

        const feeResult = await autoComputeFee(
          admin,
          schemes,
          c.id,
          period.periodStart,
          period.periodEnd,
        );

        const { detailCount } = await generatePayrollDetails(run, admin as never);
        if (detailCount === 0) continue; // gak ada aktivitas periode ini — bukan warning, cuma dilewati diam-diam

        const { warnings, totalGross, totalNet } = await validateRun(admin, run);
        const audit = await runAudit(
          { ...run, clientName: c.name },
          detailCount,
          totalGross,
          totalNet,
          warnings,
        );

        runs.push({
          runId: run.id,
          clientName: c.name,
          periodStart: period.periodStart,
          periodEnd: period.periodEnd,
          detailCount,
          totalGross,
          totalNet,
          warnings,
          audit,
          feeAutoComputed: feeResult.computed,
          feeSkipReason: feeResult.reason,
        });
      }
    }
  } catch (e) {
    hardError = (e as Error).message;
  }

  const result: PayrollWorkflowResult = { runs, skippedClients };
  // Cron sekarang polling tiap 15 menit (dulu 4x/hari) — kalau tiap tick
  // kosong (gak ada yang jatuh tempo, gak ada error) tetap kirim notif,
  // Slack/email kebanjiran "gak ada periode" puluhan kali sehari. Trigger
  // manual/event (aksi eksplisit admin) tetap dikasih notif walau hasilnya
  // kosong, itu bukan noise — itu konfirmasi dari aksi yang mereka minta.
  const isEmptyCronTick = opts.triggeredBy === "cron" && runs.length === 0 && !hardError;
  const notif = buildNotification(result);
  const slackResult = isEmptyCronTick ? null : await sendSlackMessage(notif.text);
  const emailResult = isEmptyCronTick ? null : await sendEmail({ subject: notif.subject, html: notif.html });

  const status = hardError ? (runs.length > 0 ? "partial" : "failed") : "completed";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: logRow, error: logErr } = await (admin as any)
    .from("payroll_workflow_runs")
    .insert({
      trigger_type: opts.triggeredBy,
      triggered_by:
        opts.triggeredByUserId ?? (opts.triggeredBy === "cron" ? "system-cron" : "admin"),
      status,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      result: { ...result, notifyStatus: { slack: slackResult, email: emailResult } },
      error: hardError,
    })
    .select("id")
    .single();
  if (logErr) console.error("[payroll-workflow] gagal simpan log run:", logErr.message);

  if (hardError && runs.length === 0) throw new Error(hardError);
  return { ...result, runLogId: logRow?.id as string | undefined };
}

export function verifyPayrollWorkflowSecret(headerValue: string | null): boolean {
  const expected = getServerConfig().payrollWorkflowSecret;
  return !!expected && !!headerValue && headerValue === expected;
}

// Jalankan auto-Hitung-Fee + generate run untuk 1 client+periode EKSPLISIT,
// tanpa terikat jadwal Reminder Calendar — buat verifikasi/backfill manual
// (mis. tes fitur ini pakai data bulan lalu). TIDAK kirim notif Slack/Email,
// biar aman dipakai berulang kali tanpa nge-spam channel.
export async function runFeeAndPayrollForPeriod(opts: {
  clientId: string;
  periodStart: string;
  periodEnd: string;
}): Promise<PayrollWorkflowRunResult | { skipped: string }> {
  const admin = getSupabaseAdmin();
  const [{ data: client, error: clientErr }, { data: schemesRaw }] = await Promise.all([
    admin.from("clients").select("id, name").eq("id", opts.clientId).single(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (admin as any)
      .from("pricing_schemes")
      .select("id, name, client_id, scheme_for, calc_type, effective_from, effective_to, params, created_at"),
  ]);
  if (clientErr || !client) throw new Error(`Client tidak ditemukan: ${clientErr?.message ?? opts.clientId}`);
  const schemes: PricingScheme[] = (schemesRaw ?? []).map(normalize);

  const run = await findOrCreatePayrollRun(
    { clientId: client.id, clientName: client.name, periodStart: opts.periodStart, periodEnd: opts.periodEnd },
    admin as never,
  );
  if (run.status !== "draft") return { skipped: `Run udah berstatus ${run.status}` };

  const feeResult = await autoComputeFee(admin, schemes, client.id, opts.periodStart, opts.periodEnd);
  const { detailCount } = await generatePayrollDetails(run, admin as never);
  if (detailCount === 0) return { skipped: "Gak ada aktivitas delivery/attendance di periode ini" };

  const { warnings, totalGross, totalNet } = await validateRun(admin, run);
  const audit = await runAudit({ ...run, clientName: client.name }, detailCount, totalGross, totalNet, warnings);

  return {
    runId: run.id,
    clientName: client.name,
    periodStart: opts.periodStart,
    periodEnd: opts.periodEnd,
    detailCount,
    totalGross,
    totalNet,
    warnings,
    audit,
    feeAutoComputed: feeResult.computed,
    feeSkipReason: feeResult.reason,
  };
}
