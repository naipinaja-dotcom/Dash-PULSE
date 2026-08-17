import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetch-all";
import { useAuth } from "@/lib/auth";
import { triggerPayrollReminderManual } from "@/lib/api/payroll-reminder.functions";
import { toast } from "sonner";
import { confirmDialog } from "@/components/confirm-dialog";
import { Loader2, Plus, Trash2, Pencil, Send, CheckCircle2, XCircle } from "lucide-react";
import { ScheduleFormModal } from "./payroll-reminder-panel/schedule-form-modal";
import { useT } from "@/lib/i18n";

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
  run_time: string | null;
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

const WEEKDAY_KEYS = [
  "reminderPanel.weekdaySunday",
  "reminderPanel.weekdayMonday",
  "reminderPanel.weekdayTuesday",
  "reminderPanel.weekdayWednesday",
  "reminderPanel.weekdayThursday",
  "reminderPanel.weekdayFriday",
  "reminderPanel.weekdaySaturday",
] as const;

export function PayrollReminderPanel() {
  const { t } = useT();
  const dayName = (d: number) => t(WEEKDAY_KEYS[d]);
  const { session } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [riders, setRiders] = useState<Rider[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
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
        "id, label, client_id, rider_id, weekdays, period_start_weekday, period_end_weekday, close_same_day, run_time, active, clients(name), riders(full_name, employee_id)",
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
        title: t("reminderPanel.deleteScheduleTitle"),
        description: `"${s.label}" ${t("reminderPanel.deleteScheduleDescriptionSuffix")}`,
        confirmText: t("reminderPanel.deleteConfirm"),
        danger: true,
      }))
    )
      return;
    const { error } = await (supabase as any)
      .from("payroll_reminder_schedules")
      .delete()
      .eq("id", s.id);
    if (error) return toast.error(error.message);
    toast.success(t("reminderPanel.scheduleDeleted"));
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
    if (!session?.access_token) return toast.error(t("reminderPanel.adminSessionExpired"));
    setTesting(true);
    try {
      const result = await triggerPayrollReminderManual({
        data: { adminToken: session.access_token },
      });
      if (!result.sent) {
        toast.success(t("reminderPanel.nothingDueToday"));
      } else {
        const slackOk = result.pushStatus!.slack.ok,
          emailOk = result.pushStatus!.email.ok;
        if (slackOk && emailOk) toast.success(t("reminderPanel.sentToSlackAndEmail"));
        else
          toast.warning(
            `${t("reminderPanel.slackLabel")}: ${slackOk ? t("reminderPanel.deliveryOk") : t("reminderPanel.deliveryFailedPrefix") + result.pushStatus!.slack.error}. ${t("reminderPanel.emailLabel")}: ${emailOk ? t("reminderPanel.deliveryOk") : t("reminderPanel.deliveryFailedPrefix") + result.pushStatus!.email.error}`,
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
          <h3 className="font-semibold text-sm">{t("reminderPanel.heading")}</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {t("reminderPanel.headingDescription")}
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
            {t("reminderPanel.testSendNow")}
          </button>
          <button
            onClick={() => setFormOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-[11px] font-medium hover:opacity-90 transition-opacity"
          >
            <Plus className="w-3.5 h-3.5" /> {t("reminderPanel.newSchedule")}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-border overflow-hidden">
        {schedules.length === 0 ? (
          <p className="p-4 text-[11px] text-muted-foreground text-center">
            {t("reminderPanel.noSchedulesYet")}
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
                  {s.weekdays.map((d) => dayName(d)).join(", ")}
                  {s.period_start_weekday !== null && s.period_end_weekday !== null && (
                    <span className="text-primary">
                      {" "}
                      · {t("reminderPanel.periodLabel")} {dayName(s.period_start_weekday)}–
                      {dayName(s.period_end_weekday)}
                      {s.close_same_day ? ` ${t("reminderPanel.closeSameDaySuffix")}` : ""}
                      {` @ ${s.run_time ?? "09:00"}`}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => toggleActive(s)}
                  className={`text-[10px] font-medium px-2 py-0.5 rounded-full border-2 transition-colors ${s.active ? "border-border-strong bg-success text-success-foreground" : "border-border text-muted-foreground bg-muted"}`}
                >
                  {s.active ? t("reminderPanel.active") : t("reminderPanel.inactive")}
                </button>
                <button
                  onClick={() => setEditingSchedule(s)}
                  className="p-1.5 hover:bg-muted text-muted-foreground hover:text-foreground rounded-md transition-colors"
                >
                  <Pencil className="w-3.5 h-3.5" />
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
            {t("reminderPanel.deliveryHistoryHeading")}
          </h4>
          <div className="rounded-xl border border-border overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-2.5">
                    {t("reminderPanel.tableDate")}
                  </th>
                  <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-2.5">
                    {t("reminderPanel.tableClientRiderDue")}
                  </th>
                  <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-2.5">
                    {t("reminderPanel.slackLabel")}
                  </th>
                  <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-2.5">
                    {t("reminderPanel.emailLabel")}
                  </th>
                  <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-2.5">
                    {t("reminderPanel.tableTrigger")}
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

      {(formOpen || editingSchedule) && (
        <ScheduleFormModal
          key={editingSchedule?.id ?? "new"}
          clients={clients}
          riders={riders}
          saving={saving}
          editing={editingSchedule}
          onClose={() => {
            setFormOpen(false);
            setEditingSchedule(null);
          }}
          onSave={async (rows, editingId) => {
            setSaving(true);
            const { error } = editingId
              ? await (supabase as any)
                  .from("payroll_reminder_schedules")
                  .update(rows[0])
                  .eq("id", editingId)
              : await (supabase as any).from("payroll_reminder_schedules").insert(rows);
            setSaving(false);
            if (error) return toast.error(error.message);
            toast.success(editingId ? t("reminderPanel.scheduleUpdated") : t("reminderPanel.scheduleCreated"));
            setFormOpen(false);
            setEditingSchedule(null);
            load();
          }}
        />
      )}
    </div>
  );
}
