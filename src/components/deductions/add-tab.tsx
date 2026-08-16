import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { parseRupiah } from "@/lib/format";
import { toast } from "sonner";
import { ClientCombobox } from "@/components/client-combobox";
import { DatePicker } from "@/components/date-picker";
import { useT } from "@/lib/i18n";
import type { Client, DType, MolisType, Rider } from "./types";

export function AddTab() {
  const { t } = useT();
  const [riders, setRiders] = useState<Rider[]>([]);
  const [types, setTypes] = useState<DType[]>([]);
  const [molisTypes, setMolisTypes] = useState<MolisType[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [recipients, setRecipients] = useState<{ id: string; name: string; bank_name: string; account_number: string; account_holder: string }[]>([]);
  const [f, setF] = useState({
    rider_ids: [] as string[],
    deduction_type_id: "",
    mode: "fixed" as "fixed" | "daily" | "monthly",
    total_amount: 0,
    daily_rate: 0,
    cycle_start_day: 25,
    molis_type_id: "",
    charge_target: "rider" as "rider" | "client_revenue",
    client_id: "",
    start_date: new Date().toISOString().slice(0, 10),
    installment: false,
    installment_count: 1,
    notes: "",
    kasbon_recipient_id: "",
  });
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);

  const filtered = riders.filter((r) => {
    const q = search.trim().toLowerCase();
    return !q || r.full_name.toLowerCase().includes(q) || r.employee_id.toLowerCase().includes(q);
  });
  const selectedTypeName = types.find((type) => type.id === f.deduction_type_id)?.name ?? t("dedadd.typeNotSelected");
  const selectedMode = f.mode === "fixed" ? t("dedadd.modeFixedTitle") : f.mode === "daily" ? t("dedadd.modeDailyTitle") : t("dedadd.modeMonthlyTitle");
  const summaryAmount = f.mode === "fixed" ? f.total_amount : f.daily_rate;
  const toggleRider = (id: string) =>
    setF((p) => ({
      ...p,
      rider_ids: p.rider_ids.includes(id)
        ? p.rider_ids.filter((x) => x !== id)
        : [...p.rider_ids, id],
    }));

  useEffect(() => {
    supabase
      .from("riders")
      .select("id, employee_id, full_name")
      .order("full_name")
      .then(({ data }) => setRiders(data ?? []));
    // jenis "otomatis" ga muncul di sini — dia kepotong sendiri tiap payroll, ga perlu didaftarin manual
    (supabase as any)
      .from("deduction_types")
      .select("*")
      .eq("active", true)
      .eq("auto_recurring", false)
      .then(({ data }: any) => setTypes(data ?? []));
    (supabase as any)
      .from("molis_types")
      .select("*")
      .eq("active", true)
      .order("name")
      .then(({ data }: any) => setMolisTypes(data ?? []));
    (supabase as any)
      .from("clients")
      .select("id, name")
      .order("name")
      .then(({ data }: any) => setClients(data ?? []));
    (supabase as any).from("kasbon_recipients").select("id, name, bank_name, account_number, account_holder").eq("active", true).order("name")
      .then(({ data }: any) => setRecipients(data ?? []));
  }, []);

  const save = async () => {
    if (f.rider_ids.length === 0) return toast.error(t("dedadd.errNoRider"));
    if (!f.deduction_type_id) return toast.error(t("dedadd.errNoType"));
    if ((f.mode === "daily" || f.mode === "monthly") && !f.daily_rate)
      return toast.error(t("dedadd.errNoDailyRate"));
    if (f.mode === "fixed" && !f.total_amount) return toast.error(t("dedadd.errNoTotal"));
    const selectedType = types.find((type) => type.id === f.deduction_type_id);
    if (selectedType?.code === "KASBON" && !f.kasbon_recipient_id)
      return toast.error(t("dedadd.errNoKasbonRecipient"));
    setSaving(true);
    const count = f.installment ? Math.max(1, f.installment_count) : 1;
    const per = +(f.total_amount / count).toFixed(2);
    const isMolisMode = f.mode === "daily" || f.mode === "monthly";
    const rows = f.rider_ids.map((rid) => ({
      rider_id: rid,
      deduction_type_id: f.deduction_type_id,
      mode: f.mode,
      total_amount: f.mode === "fixed" ? f.total_amount : null,
      installment_count: f.mode === "fixed" ? count : null,
      per_period_amount: f.mode === "fixed" ? per : null,
      daily_rate: isMolisMode ? f.daily_rate : null,
      cycle_start_day: f.mode === "monthly" ? f.cycle_start_day : null,
      molis_type_id: isMolisMode ? f.molis_type_id || null : null,
      charge_target: isMolisMode ? f.charge_target : "rider",
      client_id: f.client_id || null,
      start_date: f.start_date,
      next_deduction_date: f.start_date,
      notes: f.notes || null,
      kasbon_recipient_id: selectedType?.code === "KASBON" ? f.kasbon_recipient_id : null,
    }));
    const { error } = await supabase.from("rider_installments").insert(rows);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(`${t("dedadd.successAdded")} ${f.rider_ids.length} ${t("dedadd.riderLabel").toLowerCase()}`);
    setF({
      ...f,
      rider_ids: [],
      total_amount: 0,
      daily_rate: 0,
      cycle_start_day: 25,
      molis_type_id: "",
      charge_target: "rider",
      client_id: "",
      notes: "",
      kasbon_recipient_id: "",
    });
    setSearch("");
  };

  return (
    <div className="max-w-lg space-y-3 text-sm">
      <div>
        <label className="font-medium">
          {t("dedadd.riderLabel")}{" "}
          <span className="font-normal text-muted-foreground">({f.rider_ids.length} {t("dedadd.selected")})</span>
        </label>
        <input
          placeholder={t("dedadd.searchRiderPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mt-1 w-full rounded-md border-2 border-border-strong bg-background px-3 py-2 outline-none focus:ring-1 focus:ring-ring"
        />
        <div className="mt-1.5 flex items-center gap-3 text-xs">
          <button
            type="button"
            onClick={() =>
              setF((p) => ({
                ...p,
                rider_ids: Array.from(new Set([...p.rider_ids, ...filtered.map((r) => r.id)])),
              }))
            }
            className="text-primary hover:underline"
          >
            {t("dedadd.selectAll")}{search ? ` (${filtered.length})` : ""}
          </button>
          <button
            type="button"
            onClick={() => setF((p) => ({ ...p, rider_ids: [] }))}
            className="text-muted-foreground hover:text-foreground"
          >
            {t("dedadd.clearSelection")}
          </button>
        </div>
        <div className="mt-2 max-h-56 overflow-y-auto rounded-md border-2 border-border-strong divide-y divide-border">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-muted-foreground text-xs">{t("dedadd.noRiderMatch")}</div>
          ) : (
            filtered.map((r) => (
              <label
                key={r.id}
                className="flex items-center gap-2.5 px-3 py-2 hover:bg-muted cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={f.rider_ids.includes(r.id)}
                  onChange={() => toggleRider(r.id)}
                />
                <span className="font-mono text-xs text-muted-foreground">{r.employee_id}</span>
                <span>{r.full_name}</span>
              </label>
            ))
          )}
        </div>
      </div>
      <div>
        <label className="font-medium">{t("dedadd.deductionType")}</label>
        <select
          value={f.deduction_type_id}
          onChange={(e) => {
            const id = e.target.value;
            const dt = types.find((x) => x.id === id);
            // reset "Dicicil" kalau jenis yang dipilih tidak boleh dicicil
            setF({
              ...f,
              deduction_type_id: id,
              installment: dt?.installmentable ? f.installment : false,
              kasbon_recipient_id: "",
            });
          }}
          className="mt-1 w-full rounded-md border-2 border-border-strong bg-background px-3 py-2 outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="">{t("dedadd.selectTypePlaceholder")}</option>
          {types.map((dt) => (
            <option key={dt.id} value={dt.id}>
              {dt.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="font-medium">
          {t("dedadd.clientPriority")} <span className="font-normal text-muted-foreground">({t("dedadd.optional")})</span>
        </label>
        <ClientCombobox
          value={f.client_id}
          onChange={(v) => setF({ ...f, client_id: v })}
          placeholder={t("dedadd.useHomeClientPlaceholder")}
          className="mt-1 w-full text-sm py-2"
          options={clients.map((c) => ({ value: c.id, label: c.name }))}
        />
        <p className="text-xs text-muted-foreground mt-1">
          {t("dedadd.clientPriorityHint")}
        </p>
      </div>
      {types.find((type) => type.id === f.deduction_type_id)?.code === "KASBON" && (
        <div className="rounded-xl border border-warning/30 bg-warning/5 p-3 space-y-2">
          <div>
            <label className="font-medium">{t("dedadd.kasbonGiver")}</label>
            <select value={f.kasbon_recipient_id} onChange={(e) => setF({ ...f, kasbon_recipient_id: e.target.value })} className="mt-1 w-full rounded-md border-2 border-border-strong bg-background px-3 py-2 outline-none focus:ring-1 focus:ring-ring">
              <option value="">{t("dedadd.selectRecipientPlaceholder")}</option>
              {recipients.map((r) => <option key={r.id} value={r.id}>{r.name} · {r.bank_name} · {r.account_number}</option>)}
            </select>
            <p className="mt-1 text-[11px] text-muted-foreground">{t("dedadd.kasbonSettlementHint")}</p>
          </div>
          <p className="text-xs text-muted-foreground">{t("dedadd.kasbonNoRecipientHint")}</p>
        </div>
      )}
      <div className="deduction-mode-picker rounded-md border border-border p-3">
        <label className="font-medium text-xs">{t("dedadd.deductionMode")}</label>
        <div className="mt-1.5 grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => setF({ ...f, mode: "fixed" })}
            className={`deduction-mode-option text-left rounded-md px-3 py-2 border-2 text-xs ${f.mode === "fixed" ? "border-border-strong bg-primary text-primary-foreground" : "border-border"}`}
          >
            <span className="font-medium block">{t("dedadd.modeFixedTitle")}</span>
            <span className="text-muted-foreground">{t("dedadd.modeFixedDesc")}</span>
          </button>
          <button
            type="button"
            onClick={() => setF({ ...f, mode: "daily" })}
            className={`deduction-mode-option text-left rounded-md px-3 py-2 border-2 text-xs ${f.mode === "daily" ? "border-border-strong bg-primary text-primary-foreground" : "border-border"}`}
          >
            <span className="font-medium block">{t("dedadd.modeDailyTitle")}</span>
            <span className="text-muted-foreground">
              {t("dedadd.modeDailyDesc")}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setF({ ...f, mode: "monthly" })}
            className={`deduction-mode-option text-left rounded-md px-3 py-2 border-2 text-xs ${f.mode === "monthly" ? "border-border-strong bg-primary text-primary-foreground" : "border-border"}`}
          >
            <span className="font-medium block">{t("dedadd.modeMonthlyTitle")}</span>
            <span className="text-muted-foreground">
              {t("dedadd.modeMonthlyDesc")}
            </span>
          </button>
        </div>
      </div>
      {f.mode === "fixed" ? (
        <div>
          <label className="font-medium">{t("dedadd.totalAmount")}</label>
          <input
            inputMode="numeric"
            placeholder="0"
            value={f.total_amount ? f.total_amount.toLocaleString("id-ID") : ""}
            onChange={(e) => setF({ ...f, total_amount: parseRupiah(e.target.value) })}
            className="mt-1 w-full rounded-md border-2 border-border-strong bg-background px-3 py-2 outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      ) : (
        <div className="space-y-3">
          {molisTypes.length > 0 && (
            <div>
              <label className="font-medium">{t("dedadd.molisType")}</label>
              <select
                value={f.molis_type_id}
                onChange={(e) => {
                  const id = e.target.value;
                  const mt = molisTypes.find((m) => m.id === id);
                  setF({
                    ...f,
                    molis_type_id: id,
                    daily_rate: mt ? mt.default_daily_rate : f.daily_rate,
                  });
                }}
                className="mt-1 w-full rounded-md border-2 border-border-strong bg-background px-3 py-2 outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">{t("dedadd.notMolisPlaceholder")}</option>
                {molisTypes.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} (Rp{Number(m.default_daily_rate).toLocaleString("id-ID")}/{t("dedadd.perDayUnit")})
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="font-medium">{t("dedadd.dailyRate")}</label>
            <input
              inputMode="numeric"
              placeholder={t("dedadd.dailyRatePlaceholder")}
              value={f.daily_rate ? f.daily_rate.toLocaleString("id-ID") : ""}
              onChange={(e) => setF({ ...f, daily_rate: parseRupiah(e.target.value) })}
              className="mt-1 w-full rounded-md border-2 border-border-strong bg-background px-3 py-2 outline-none focus:ring-1 focus:ring-ring"
            />
            {f.mode === "daily" ? (
              <p className="text-xs text-muted-foreground mt-1">
                {t("dedadd.dailyRateHintDaily")}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground mt-1">
                {t("dedadd.dailyRateHintMonthly")}
              </p>
            )}
          </div>
          {f.mode === "monthly" && (
            <div>
              <label className="font-medium">{t("dedadd.cycleStartDate")}</label>
              <input
                type="number"
                min={1}
                max={31}
                value={f.cycle_start_day}
                onChange={(e) => setF({ ...f, cycle_start_day: Math.min(31, Math.max(1, +e.target.value || 1)) })}
                className="mt-1 w-32 rounded-md border border-border bg-background px-3 py-2"
              />
              <p className="text-xs text-muted-foreground mt-1">
                {t("dedadd.cycleHintPart1")} {f.cycle_start_day} {t("dedadd.cycleHintPart2")} {f.cycle_start_day - 1 || 31}{" "}
                {t("dedadd.cycleHintPart3")}
              </p>
            </div>
          )}
          <div>
            <label className="font-medium">{t("dedadd.chargeTarget")}</label>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setF({ ...f, charge_target: "rider" })}
                className={`text-left rounded-md px-3 py-2 border text-xs ${f.charge_target === "rider" ? "border-primary bg-primary-soft" : "border-border"}`}
              >
                <span className="font-medium block">{t("dedadd.chargeTargetRiderTitle")}</span>
                <span className="text-muted-foreground">{t("dedadd.chargeTargetRiderDesc")}</span>
              </button>
              <button
                type="button"
                onClick={() => setF({ ...f, charge_target: "client_revenue" })}
                className={`text-left rounded-md px-3 py-2 border text-xs ${f.charge_target === "client_revenue" ? "border-primary bg-primary-soft" : "border-border"}`}
              >
                <span className="font-medium block">{t("dedadd.chargeTargetClientTitle")}</span>
                <span className="text-muted-foreground">
                  {t("dedadd.chargeTargetClientDesc")}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
      <div>
        <label className="font-medium">{t("dedadd.startDate")}</label>
        <DatePicker value={f.start_date} onChange={(v) => setF({ ...f, start_date: v })} className="mt-1 w-full" />
      </div>
      {f.mode === "fixed" &&
        (() => {
          const canInstallment = !!types.find((dt) => dt.id === f.deduction_type_id)?.installmentable;
          return (
            <>
              <label
                className={`flex items-center gap-2 ${canInstallment ? "" : "opacity-50 cursor-not-allowed"}`}
              >
                <input
                  type="checkbox"
                  disabled={!canInstallment}
                  checked={f.installment && canInstallment}
                  onChange={(e) => setF({ ...f, installment: e.target.checked })}
                />{" "}
                {t("dedadd.installmentCheckbox")}
              </label>
              {f.deduction_type_id && !canInstallment && (
                <p className="text-xs text-muted-foreground">
                  {t("dedadd.installmentNotAllowed")}
                </p>
              )}
            </>
          );
        })()}
      {f.mode === "fixed" && f.installment && (
        <div>
          <label className="font-medium">{t("dedadd.installmentCount")}</label>
          <input
            type="number"
            min={1}
            value={f.installment_count}
            onChange={(e) => setF({ ...f, installment_count: +e.target.value })}
            className="mt-1 w-full rounded-md border-2 border-border-strong bg-background px-3 py-2 outline-none focus:ring-1 focus:ring-ring"
          />
          <p className="text-xs text-muted-foreground mt-1">
            {t("dedadd.perPeriod")}: Rp
            {(f.total_amount / Math.max(1, f.installment_count)).toLocaleString("id-ID")}
          </p>
        </div>
      )}
      <div>
        <label className="font-medium">{t("dedadd.notes")}</label>
        <input
          value={f.notes}
          onChange={(e) => setF({ ...f, notes: e.target.value })}
          className="mt-1 w-full rounded-md border-2 border-border-strong bg-background px-3 py-2 outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      <div className="deduction-save-area" aria-live="polite">
        <div className="deduction-summary" aria-label={t("dedadd.summaryAriaLabel")}>
          <div><span>{t("dedadd.riderLabel")}</span><strong>{f.rider_ids.length || "—"}</strong></div>
          <div><span>{t("dedadd.summarySchemeLabel")}</span><strong>{selectedMode}</strong></div>
          <div><span>{t("dedadd.summaryAmountLabel")}</span><strong>Rp{summaryAmount.toLocaleString("id-ID")}</strong></div>
          <p>{selectedTypeName}</p>
        </div>
        <button
          onClick={save}
          disabled={saving}
          className="deduction-save-button rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm disabled:opacity-50"
        >
          {saving ? t("dedadd.saving") : t("dedadd.saveDeduction")}
        </button>
      </div>
    </div>
  );
}
