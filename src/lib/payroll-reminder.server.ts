// Payroll Disbursement Reminder (PRD.md §10 backlog #8) — core logic dipakai bareng oleh:
//   - src/routes/api.payroll-reminder.ts (dipanggil cron harian via HTTP)
//   - src/lib/api/payroll-reminder.functions.ts (tombol "Test Kirim Sekarang" di admin)
// Server-only: import Supabase admin client + kirim ke Slack/Email di sini.
import { getSupabaseAdmin } from "./supabase-admin.server";
import { getServerConfig } from "./config.server";
import { sendSlackMessage } from "./notify/slack.server";
import { sendEmail } from "./notify/email.server";

type Schedule = {
  id: string;
  label: string;
  client_id: string | null;
  rider_id: string | null;
  weekdays: number[];
  clients: { name: string } | null;
  riders: { full_name: string; employee_id: string } | null;
};

type DueClient = { id: string; name: string };
type DueRider = { id: string; full_name: string; employee_id: string; client_name: string | null };

// 0=Minggu .. 6=Sabtu, sama seperti Date.getUTCDay(). Cron jalan 07:00 WIB (00:00
// UTC) jadi tanggal UTC == tanggal kalender WIB di jam segitu, aman dipakai langsung.
function weekdayOf(dateISO: string): number {
  return new Date(`${dateISO}T00:00:00Z`).getUTCDay();
}

const WEEKDAY_NAMES = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

function buildSlackText(dateISO: string, dueClients: DueClient[], dueRiders: DueRider[]) {
  const lines = [`*💰 Reminder Disbursement — ${WEEKDAY_NAMES[weekdayOf(dateISO)]}, ${dateISO}*`];
  if (dueClients.length) lines.push(`Client yang harus digaji hari ini: ${dueClients.map((c) => c.name).join(", ")}`);
  if (dueRiders.length) {
    lines.push(`Rider spesifik yang harus digaji hari ini:`);
    dueRiders.forEach((r) => lines.push(`• ${r.full_name} (${r.employee_id})${r.client_name ? ` — ${r.client_name}` : ""}`));
  }
  return lines.join("\n");
}

function buildEmailHtml(dateISO: string, dueClients: DueClient[], dueRiders: DueRider[]) {
  const clientRows = dueClients.map((c) => `<li>${c.name}</li>`).join("");
  const riderRows = dueRiders.map((r) => `<li>${r.full_name} (${r.employee_id})${r.client_name ? ` — ${r.client_name}` : ""}</li>`).join("");
  return `
  <div style="font-family:sans-serif;max-width:640px;margin:0 auto">
    <h2>Reminder Disbursement — ${WEEKDAY_NAMES[weekdayOf(dateISO)]}, ${dateISO}</h2>
    ${dueClients.length ? `<p><b>Client yang harus digaji hari ini:</b></p><ul>${clientRows}</ul>` : ""}
    ${dueRiders.length ? `<p><b>Rider spesifik yang harus digaji hari ini:</b></p><ul>${riderRows}</ul>` : ""}
    <p style="color:#888;font-size:12px;margin-top:16px">Dikirim otomatis oleh Dash PULSE — Payroll Reminder.</p>
  </div>`;
}

export interface PayrollReminderResult {
  date: string;
  dueClients: DueClient[];
  dueRiders: DueRider[];
  sent: boolean; // false kalau ga ada yang jatuh tempo -> Slack/Email sengaja ga dikirim
  pushStatus?: { slack: { ok: boolean; error?: string }; email: { ok: boolean; error?: string } };
  logId?: string;
}

export async function runPayrollReminderCheck(opts: {
  triggeredBy: "cron" | "manual";
  triggeredByUserId?: string;
  forDate?: string;
}): Promise<PayrollReminderResult> {
  const admin = getSupabaseAdmin();
  const date = opts.forDate ?? new Date().toISOString().slice(0, 10);
  const weekday = weekdayOf(date);

  const { data: schedulesRaw, error } = await (admin as any)
    .from("payroll_reminder_schedules")
    .select("id, label, client_id, rider_id, weekdays, clients(name), riders(full_name, employee_id)")
    .eq("active", true);
  if (error) throw new Error(`Gagal ambil jadwal reminder: ${error.message}`);

  const due = ((schedulesRaw ?? []) as Schedule[]).filter((s) => s.weekdays.includes(weekday));

  const dueClientsMap = new Map<string, DueClient>();
  const dueRidersMap = new Map<string, DueRider>();
  for (const s of due) {
    if (s.client_id && !s.rider_id && s.clients) dueClientsMap.set(s.client_id, { id: s.client_id, name: s.clients.name });
    if (s.rider_id && s.riders) {
      dueRidersMap.set(s.rider_id, {
        id: s.rider_id,
        full_name: s.riders.full_name,
        employee_id: s.riders.employee_id,
        client_name: s.clients?.name ?? null,
      });
    }
  }
  const dueClients = Array.from(dueClientsMap.values());
  const dueRiders = Array.from(dueRidersMap.values());

  if (dueClients.length === 0 && dueRiders.length === 0) {
    return { date, dueClients, dueRiders, sent: false };
  }

  const slackResult = await sendSlackMessage(buildSlackText(date, dueClients, dueRiders));
  const emailResult = await sendEmail({
    subject: `Reminder Disbursement — ${date}`,
    html: buildEmailHtml(date, dueClients, dueRiders),
  });
  const pushStatus = { slack: slackResult, email: emailResult };

  const { data: log, error: insErr } = await (admin as any)
    .from("payroll_reminder_log")
    .insert({
      reminder_date: date,
      due_clients: dueClients,
      due_riders: dueRiders,
      push_status: pushStatus,
      triggered_by: opts.triggeredBy,
      triggered_by_user: opts.triggeredByUserId ?? null,
    })
    .select("id")
    .single();
  if (insErr) throw new Error(`Gagal simpan log reminder: ${insErr.message}`);

  return { date, dueClients, dueRiders, sent: true, pushStatus, logId: log.id };
}

export function verifyPayrollReminderSecret(headerValue: string | null): boolean {
  const expected = getServerConfig().payrollReminderSecret;
  if (!expected) return false;
  return !!headerValue && headerValue === expected;
}
