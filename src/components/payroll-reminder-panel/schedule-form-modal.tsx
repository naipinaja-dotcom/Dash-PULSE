import { useState } from "react";
import { toast } from "sonner";
import { useT } from "@/lib/i18n";
import { sanitizeTimeInput } from "@/components/pricing-form/shared";

type Client = { id: string; name: string };
type Rider = { id: string; full_name: string; employee_id: string };

const WEEKDAY_KEYS = [
  "reminderModal.weekdaySunday",
  "reminderModal.weekdayMonday",
  "reminderModal.weekdayTuesday",
  "reminderModal.weekdayWednesday",
  "reminderModal.weekdayThursday",
  "reminderModal.weekdayFriday",
  "reminderModal.weekdaySaturday",
] as const;

export type ScheduleRow = {
  label: string;
  client_id: string | null;
  rider_id: string | null;
  weekdays: number[];
  period_start_weekday: number | null;
  period_end_weekday: number | null;
  close_same_day: boolean;
  run_time: string | null;
};

export type EditingSchedule = ScheduleRow & {
  id: string;
  clients: { name: string } | null;
  riders: { full_name: string; employee_id: string } | null;
};

export function ScheduleFormModal({
  clients,
  riders,
  saving,
  editing,
  onClose,
  onSave,
}: {
  clients: Client[];
  riders: Rider[];
  saving: boolean;
  editing?: EditingSchedule | null;
  onClose: () => void;
  onSave: (rows: ScheduleRow[], editingId?: string) => void;
}) {
  const { t } = useT();
  const dayName = (d: number) => t(WEEKDAY_KEYS[d]);
  const [label, setLabel] = useState(editing?.label ?? "");
  const [clientIds, setClientIds] = useState<string[]>(editing?.client_id ? [editing.client_id] : []);
  const [riderIds, setRiderIds] = useState<string[]>(editing?.rider_id ? [editing.rider_id] : []);
  const [clientSearch, setClientSearch] = useState("");
  const [riderSearch, setRiderSearch] = useState("");
  const [weekdays, setWeekdays] = useState<number[]>(editing?.weekdays ?? []);
  const [periodOn, setPeriodOn] = useState(editing?.period_start_weekday != null);
  const [periodStartWeekday, setPeriodStartWeekday] = useState(editing?.period_start_weekday ?? 1); // Senin
  const [periodEndWeekday, setPeriodEndWeekday] = useState(editing?.period_end_weekday ?? 0); // Minggu
  const [closeSameDay, setCloseSameDay] = useState(editing?.close_same_day ?? false);
  const [runTime, setRunTime] = useState(editing?.run_time ?? "");

  const toggleDay = (d: number) =>
    setWeekdays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));
  const toggleClient = (id: string) =>
    setClientIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const toggleRider = (id: string) =>
    setRiderIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const visibleClients = clients.filter((c) =>
    c.name.toLowerCase().includes(clientSearch.toLowerCase()),
  );
  const visibleRiders = riders.filter((r) =>
    `${r.full_name} ${r.employee_id}`.toLowerCase().includes(riderSearch.toLowerCase()),
  );

  // 1 baris = 1 client ATAU 1 rider (bukan kombinasi silang) — pilih banyak
  // client/rider sekaligus di sini cuma bikin banyak baris identik dalam
  // 1x submit, biar ga perlu buka form berkali-kali buat tiap client.
  const submit = () => {
    if (!label.trim()) return toast.error(t("reminderModal.labelRequired"));
    if (clientIds.length === 0 && riderIds.length === 0)
      return toast.error(t("reminderModal.pickAtLeastOneClientOrRider"));
    if (weekdays.length === 0) return toast.error(t("reminderModal.pickAtLeastOneDay"));
    const period = periodOn
      ? { period_start_weekday: periodStartWeekday, period_end_weekday: periodEndWeekday, close_same_day: closeSameDay, run_time: runTime.trim() || null }
      : { period_start_weekday: null, period_end_weekday: null, close_same_day: false, run_time: null };
    if (editing) {
      // 1 baris edit = target client/rider-nya tetap (lihat picker read-only di bawah).
      const row: ScheduleRow = editing.client_id
        ? { label: label.trim(), client_id: editing.client_id, rider_id: null, weekdays, ...period }
        : { label: label.trim(), client_id: null, rider_id: editing.rider_id, weekdays, period_start_weekday: null, period_end_weekday: null, close_same_day: false, run_time: null };
      return onSave([row], editing.id);
    }
    const rows: ScheduleRow[] = [
      ...clientIds.map((id) => ({ label: label.trim(), client_id: id, rider_id: null, weekdays, ...period })),
      ...riderIds.map((id) => ({ label: label.trim(), client_id: null, rider_id: id, weekdays, period_start_weekday: null, period_end_weekday: null, close_same_day: false, run_time: null })),
    ];
    onSave(rows);
  };

  return (
    <div className="reminder-modal-backdrop fixed inset-0 grid place-items-center z-50 p-4" onClick={onClose}>
      <div
        className="reminder-schedule-modal w-full max-w-lg max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="reminder-modal-header">
          <span data-eyebrow>{t("reminderModal.eyebrow")}</span>
          <h2>{editing ? t("reminderModal.editHeading") : t("reminderModal.heading")}</h2>
          <p>{t("reminderModal.headingDescription")}</p>
          <span className="reminder-modal-number" aria-hidden="true">01</span>
        </div>
        <div className="reminder-modal-body space-y-4 text-sm">
          <div className="reminder-field">
            <label className="font-medium">{t("reminderModal.batchNameLabel")}</label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t("reminderModal.batchNamePlaceholder")}
              className="mt-1 w-full rounded-md border-2 border-border-strong bg-background px-3 py-2 outline-none focus:ring-1 focus:ring-ring"
            />
            <p className="text-xs text-muted-foreground mt-1">
              {t("reminderModal.batchNameHint")}
            </p>
          </div>
          {editing ? (
            <div className="reminder-field">
              <label className="font-medium">
                {editing.client_id ? t("reminderModal.clientLabel") : t("reminderModal.riderLabel")}
              </label>
              <p className="mt-1 rounded-md border-2 border-border-strong bg-muted/40 px-3 py-2 text-xs">
                {editing.clients?.name ??
                  (editing.riders ? `${editing.riders.full_name} (${editing.riders.employee_id})` : "—")}
              </p>
              <p className="text-xs text-muted-foreground mt-1">{t("reminderModal.editTargetLockedHint")}</p>
            </div>
          ) : (
            <>
              <div className="reminder-field reminder-picker">
                <label className="font-medium">
                  {t("reminderModal.clientLabel")}{" "}
                  <span className="font-normal text-muted-foreground">
                    {t("reminderModal.multiSelectHint")}
                  </span>
                </label>
                <input
                  value={clientSearch}
                  onChange={(e) => setClientSearch(e.target.value)}
                  placeholder={t("reminderModal.searchClientPlaceholder")}
                  className="mt-1 w-full rounded-md border-2 border-border-strong bg-background px-3 py-1.5 text-xs outline-none focus:ring-1 focus:ring-ring"
                />
                <div className="mt-1 max-h-32 overflow-y-auto rounded-md border-2 border-border-strong divide-y divide-border">
                  {visibleClients.length === 0 ? (
                    <p className="p-2 text-xs text-muted-foreground">{t("reminderModal.noMatch")}</p>
                  ) : (
                    visibleClients.map((c) => (
                      <label
                        key={c.id}
                        className="flex items-center gap-2 px-2 py-1.5 text-xs cursor-pointer hover:bg-muted/50"
                      >
                        <input
                          type="checkbox"
                          checked={clientIds.includes(c.id)}
                          onChange={() => toggleClient(c.id)}
                        />
                        {c.name}
                      </label>
                    ))
                  )}
                </div>
                {clientIds.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    <span className="reminder-selection-chip">
                      {clientIds.length} {t("reminderModal.clientsSelected")}
                    </span>
                  </p>
                )}
              </div>
              <div className="reminder-field reminder-picker">
                <label className="font-medium">
                  {t("reminderModal.riderLabel")}{" "}
                  <span className="font-normal text-muted-foreground">
                    {t("reminderModal.riderOptionalHint")}
                  </span>
                </label>
                <input
                  value={riderSearch}
                  onChange={(e) => setRiderSearch(e.target.value)}
                  placeholder={t("reminderModal.searchRiderPlaceholder")}
                  className="mt-1 w-full rounded-md border-2 border-border-strong bg-background px-3 py-1.5 text-xs outline-none focus:ring-1 focus:ring-ring"
                />
                <div className="mt-1 max-h-32 overflow-y-auto rounded-md border-2 border-border-strong divide-y divide-border">
                  {riderSearch.trim() === "" ? (
                    <p className="p-2 text-xs text-muted-foreground">
                      {t("reminderModal.typeToSearchRiders")} ({riders.length} {t("reminderModal.total")})
                    </p>
                  ) : visibleRiders.length === 0 ? (
                    <p className="p-2 text-xs text-muted-foreground">{t("reminderModal.noMatch")}</p>
                  ) : (
                    visibleRiders.slice(0, 50).map((r) => (
                      <label
                        key={r.id}
                        className="flex items-center gap-2 px-2 py-1.5 text-xs cursor-pointer hover:bg-muted/50"
                      >
                        <input
                          type="checkbox"
                          checked={riderIds.includes(r.id)}
                          onChange={() => toggleRider(r.id)}
                        />
                        {r.full_name} ({r.employee_id})
                      </label>
                    ))
                  )}
                </div>
                {riderIds.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    <span className="reminder-selection-chip">
                      {riderIds.length} {t("reminderModal.ridersSelected")}
                    </span>
                  </p>
                )}
              </div>
            </>
          )}
          <div className="reminder-field reminder-weekdays">
            <label className="font-medium">{t("reminderModal.sendDaysLabel")}</label>
            <p className="text-xs text-muted-foreground mt-0.5">{t("reminderModal.sendDaysHint")}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {WEEKDAY_KEYS.map((_, d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleDay(d)}
                  className={`reminder-weekday px-2.5 py-1 rounded text-xs border-2 ${weekdays.includes(d) ? "bg-primary text-primary-foreground border-border-strong" : "border-border-strong"}`}
                >
                  {dayName(d)}
                </button>
              ))}
            </div>
          </div>
          {clientIds.length > 0 && (
            <div className="reminder-period-panel rounded-md border-2 border-border-strong p-3">
              <label className="flex items-center gap-2 font-medium cursor-pointer">
                <input type="checkbox" checked={periodOn} onChange={(e) => setPeriodOn(e.target.checked)} />
                {t("reminderModal.customPeriodLabel")}
              </label>
              <p className="text-xs text-muted-foreground mt-1">
                {t("reminderModal.customPeriodHint")}
              </p>
              {periodOn && (
                <div className="mt-2 flex items-center gap-2 text-xs">
                  <select
                    value={periodStartWeekday}
                    onChange={(e) => setPeriodStartWeekday(Number(e.target.value))}
                    className="rounded-md border-2 border-border-strong bg-background px-2 py-1.5 outline-none focus:ring-1 focus:ring-ring"
                  >
                    {WEEKDAY_KEYS.map((_, d) => (
                      <option key={d} value={d}>{dayName(d)}</option>
                    ))}
                  </select>
                  <span className="text-muted-foreground">{t("reminderModal.periodUntil")}</span>
                  <select
                    value={periodEndWeekday}
                    onChange={(e) => setPeriodEndWeekday(Number(e.target.value))}
                    className="rounded-md border-2 border-border-strong bg-background px-2 py-1.5 outline-none focus:ring-1 focus:ring-ring"
                  >
                    {WEEKDAY_KEYS.map((_, d) => (
                      <option key={d} value={d}>{dayName(d)}</option>
                    ))}
                  </select>
                </div>
              )}
              {periodOn && (
                <label className="flex items-start gap-2 mt-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={closeSameDay}
                    onChange={(e) => setCloseSameDay(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span className="text-xs">
                    <span className="font-medium">{t("reminderModal.closeSameDayLabel")}</span>{" "}
                    <span className="text-muted-foreground">
                      — {t("reminderModal.closeSameDayHintPrefix")} ({dayName(periodEndWeekday)}){" "}
                      {t("reminderModal.closeSameDayHintSuffix")}
                    </span>
                  </span>
                </label>
              )}
              {periodOn && (
                <div className="mt-2.5">
                  <label className="text-xs font-medium">{t("reminderModal.runTimeLabel")}</label>
                  <div className="flex items-center gap-2 mt-1">
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="09:00"
                      value={runTime}
                      onChange={(e) => setRunTime(sanitizeTimeInput(e.target.value))}
                      maxLength={5}
                      className="w-20 text-xs rounded-md border-2 border-border-strong bg-background px-2 py-1.5 outline-none focus:ring-1 focus:ring-ring"
                    />
                    <span className="text-[11px] text-muted-foreground">{t("reminderModal.runTimeHint")}</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="reminder-modal-footer flex justify-end gap-2">
          <button onClick={onClose} className="reminder-cancel-button px-3 py-1.5 text-sm rounded border-2 border-border-strong">
            {t("reminderModal.cancel")}
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="reminder-save-button px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground disabled:opacity-50"
          >
            {saving
              ? t("reminderModal.saving")
              : `${t("reminderModal.save")}${clientIds.length + riderIds.length > 1 ? ` (${clientIds.length + riderIds.length} ${t("reminderModal.schedulesCount")})` : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}
