import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetch-all";
import { useAuth } from "@/lib/auth";
import { triggerPayrollReminderManual } from "@/lib/api/payroll-reminder.functions";
import { toast } from "sonner";
import { confirmDialog } from "@/components/confirm-dialog";
import { Loader2, Plus, Trash2, Send, CheckCircle2, XCircle } from "lucide-react";
import { ScheduleFormModal } from "./payroll-reminder-panel/schedule-form-modal";

type Client = { id: string; name: string };
type Rider = { id: string; full_name: string; employee_id: string };
type Schedule = {
  id: string;
  label: string;
  client_id: string | null;
  rider_id: string | null;
  weekdays: number[];
  period_start_weekday: number | null;
  period_end_weekday: number | null;
  close_same_day: boolean;
  active: boolean;
  clients: { name: string } | null;
  riders: { full_name: string; employee_id: string } | null;
};
type LogRow = {
  id: string;
  reminder_date: string;
  due_clients: { id: string; name: string }[];
  due_riders: { id: string; full_name: string; employee_id: string }[];
  push_status: { slack: { ok: boolean; error?: string }; email: { ok: boolean; error?: string } };
  triggered_by: string;
  created_at: string;
};

const WEEKDAYS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

export function PayrollReminderPanel() {
  const { session } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [riders, setRiders] = useState<Rider[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const load = () => {
    supabase
      .from("clients")
      .select("id, name")
      .order("name")
      .then(({ data }) => setClients(data ?? []));
    fetchAllRows<Rider>((c, from, to) =>
      c.from("riders").select("id, full_name, employee_id").order("full_name").range(from, to),
    ).then(setRiders);
    (supabase as any)
      .from("payroll_reminder_schedules")
      .select(
        "id, label, client_id, rider_id, weekdays, period_start_weekday, period_end_weekday, close_same_day, active, clients(name), riders(full_name, employee_id)",
      )
      .order("created_at", { ascending: false })
      .then(({ data }: { data: Schedule[] | null }) => setSchedules(data ?? []));
    (supabase as any)
      .from("payroll_reminder_log")
      .select("id, reminder_date, due_clients, due_riders, push_status, triggered_by, created_at")
      .order("reminder_date", { ascending: false })
      .limit(10)
      .then(({ data }: { data: LogRow[] | null }) => setLogs(data ?? []));
  };
  useEffect(load, []);

  const deleteSchedule = async (s: Schedule) => {
    if (
      !(await confirmDialog({
        title: "Hapus jadwal reminder?",
        description: `"${s.label}" akan dihapus.`,
        confirmText: "Hapus",
        danger: true,
      }))
    )
      return;
    const { error } = await (supabase as any)
      .from("payroll_reminder_schedules")
      .delete()
      .eq("id", s.id);
    if (error) return toast.error(error.message);
    toast.success("Jadwal dihapus");
    load();
  };

  const toggleActive = async (s: Schedule) => {
    const { error } = await (supabase as any)
      .from("payroll_reminder_schedules")
      .update({ active: !s.active })
      .eq("id", s.id);
    if (error) return toast.error(error.message);
    load();
  };

  const testSend = async () => {
    if (!session?.access_token) return toast.error("Sesi admin habis — login ulang");
    setTesting(true);
    try {
      const result = await triggerPayrollReminderManual({
        data: { adminToken: session.access_token },
      });
      if (!result.sent) {
        toast.success(
          "Dicek — tidak ada client/rider yang jatuh tempo hari ini, jadi Slack/Email sengaja tidak dikirim.",
        );
      } else {
        const slackOk = result.pushStatus!.slack.ok,
          emailOk = result.pushStatus!.email.ok;
        if (slackOk && emailOk) toast.success("Reminder berhasil dikirim ke Slack & Email");
        else
          toast.warning(
            `Slack: ${slackOk ? "OK" : "gagal — " + result.pushStatus!.slack.error}. Email: ${emailOk ? "OK" : "gagal — " + result.pushStatus!.email.error}`,
          );
      }
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="rounded-xl border-[3px] border-border-strong bg-card shadow-[6px_6px_0_0_var(--color-border-strong)] p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-sm">Jadwal Reminder Disbursement</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Ingatkan Admin/Ops lewat Slack + Email client/rider mana yang harus digaji hari itu,
            sesuai siklus masing-masing. Cron belum diaktifkan — pakai "Test Kirim Sekarang" untuk
            cek manual.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={testSend}
            disabled={testing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-[11px] text-muted-foreground hover:border-primary-border hover:text-primary transition-colors disabled:opacity-50"
          >
            {testing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Send className="w-3.5 h-3.5" />
            )}{" "}
            Test Kirim Sekarang
          </button>
          <button
            onClick={() => setFormOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-[11px] font-medium hover:opacity-90 transition-opacity"
          >
            <Plus className="w-3.5 h-3.5" /> Jadwal Baru
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-border overflow-hidden">
        {schedules.length === 0 ? (
          <p className="p-4 text-[11px] text-muted-foreground text-center">
            Belum ada jadwal reminder.
          </p>
        ) : (
          schedules.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between gap-2 p-3 text-[12px] border-b border-border last:border-b-0 hover:bg-muted/40 transition-colors"
            >
              <div className="min-w-0">
                <div className="font-semibold text-foreground truncate">{s.label}</div>
                <div className="text-muted-foreground truncate text-[11px]">
                  {s.clients?.name}
                  {s.clients && s.riders ? " · " : ""}
                  {s.riders ? `${s.riders.full_name} (${s.riders.employee_id})` : ""}
                  {" — "}
                  {s.weekdays.map((d) => WEEKDAYS[d]).join(", ")}
                  {s.period_start_weekday !== null && s.period_end_weekday !== null && (
                    <span className="text-primary">
                      {" "}
                      · Periode {WEEKDAYS[s.period_start_weekday]}–{WEEKDAYS[s.period_end_weekday]}
                      {s.close_same_day ? " (tutup hari sama)" : ""}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => toggleActive(s)}
                  className={`text-[10px] font-medium px-2 py-0.5 rounded-full border-2 transition-colors ${s.active ? "border-border-strong bg-success text-success-foreground" : "border-border text-muted-foreground bg-muted"}`}
                >
                  {s.active ? "Aktif" : "Nonaktif"}
                </button>
                <button
                  onClick={() => deleteSchedule(s)}
                  className="p-1.5 hover:bg-destructive/10 text-muted-foreground hover:text-destructive rounded-md transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {logs.length > 0 && (
        <div>
          <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
            Histori Pengiriman (10 terakhir)
          </h4>
          <div className="rounded-xl border border-border overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-2.5">
                    Tanggal
                  </th>
                  <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-2.5">
                    Client/Rider Due
                  </th>
                  <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-2.5">
                    Slack
                  </th>
                  <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-2.5">
                    Email
                  </th>
                  <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-2.5">
                    Trigger
                  </th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr
                    key={l.id}
                    className="border-b border-border last:border-b-0 hover:bg-muted/40 transition-colors"
                  >
                    <td className="p-2.5 text-muted-foreground">{l.reminder_date}</td>
                    <td className="p-2.5 text-muted-foreground">
                      {[
                        ...l.due_clients.map((c) => c.name),
                        ...l.due_riders.map((r) => r.full_name),
                      ].join(", ") || "—"}
                    </td>
                    <td className="p-2.5">
                      {l.push_status.slack.ok ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-success" />
                      ) : (
                        <XCircle className="w-3.5 h-3.5 text-destructive" />
                      )}
                    </td>
                    <td className="p-2.5">
                      {l.push_status.email.ok ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-success" />
                      ) : (
                        <XCircle className="w-3.5 h-3.5 text-destructive" />
                      )}
                    </td>
                    <td className="p-2.5 text-muted-foreground">{l.triggered_by}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {formOpen && (
        <ScheduleFormModal
          clients={clients}
          riders={riders}
          saving={saving}
          onClose={() => setFormOpen(false)}
          onSave={async (rows) => {
            setSaving(true);
            const { error } = await (supabase as any)
              .from("payroll_reminder_schedules")
              .insert(rows);
            setSaving(false);
            if (error) return toast.error(error.message);
            toast.success("Jadwal dibuat");
            setFormOpen(false);
            load();
          }}
        />
      )}
    </div>
  );
}
