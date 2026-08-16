import { Fragment, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { parseRupiah } from "@/lib/format";
import { confirmDialog } from "@/components/confirm-dialog";
import { BulkActionBar } from "@/components/bulk-action-bar";
import { useBulkSelect } from "@/hooks/use-bulk-select";
import { toast } from "sonner";
import { Plus, Trash2, Loader2, X, Users } from "lucide-react";
import type { Client, DType, Rider } from "./types";
import { useT } from "@/lib/i18n";

export function DTypesTab() {
  const { t } = useT();
  const [rows, setRows] = useState<DType[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [nf, setNf] = useState({
    code: "",
    name: "",
    description: "",
    installmentable: false,
    auto_recurring: false,
    recurring_amount: 0,
    trigger_frequency: "every_payroll_run" as "every_payroll_run" | "monthly_once",
    applies_to_all: true,
  });
  const [saving, setSaving] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const bulk = useBulkSelect(rows.map((r) => r.id));

  // Kelola rider mana yang kena buat auto-recurring type dengan
  // applies_to_all=false (mis. BPJS cuma sebagian rider) — dibuka per baris.
  const [managingId, setManagingId] = useState<string | null>(null);
  const [riders, setRiders] = useState<Rider[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [enrolledIds, setEnrolledIds] = useState<Set<string>>(new Set());
  // Client prioritas per rider yang terdaftar (mis. BPJS JKK ridernya kerja di
  // 2 client — pilih client mana yang nanggung, null = client rumah rider).
  const [enrolledClient, setEnrolledClientMap] = useState<Map<string, string | null>>(new Map());
  const [riderSearch, setRiderSearch] = useState("");

  const openManage = async (r: DType) => {
    setManagingId(r.id);
    setRiderSearch("");
    if (riders.length === 0) {
      const { data } = await supabase.from("riders").select("id, employee_id, full_name").order("full_name");
      setRiders(data ?? []);
    }
    if (clients.length === 0) {
      const { data } = await (supabase as any).from("clients").select("id, name").order("name");
      setClients(data ?? []);
    }
    const { data: enrolled } = await (supabase as any)
      .from("deduction_type_riders")
      .select("rider_id, client_id")
      .eq("deduction_type_id", r.id);
    setEnrolledIds(new Set((enrolled ?? []).map((e: { rider_id: string }) => e.rider_id)));
    setEnrolledClientMap(
      new Map((enrolled ?? []).map((e: { rider_id: string; client_id: string | null }) => [e.rider_id, e.client_id])),
    );
  };

  const toggleEnrolled = async (typeId: string, riderId: string) => {
    const isEnrolled = enrolledIds.has(riderId);
    const next = new Set(enrolledIds);
    isEnrolled ? next.delete(riderId) : next.add(riderId);
    setEnrolledIds(next); // optimistic, dibalik lagi kalau gagal
    const { error } = isEnrolled
      ? await (supabase as any).from("deduction_type_riders").delete()
          .eq("deduction_type_id", typeId).eq("rider_id", riderId)
      : await (supabase as any).from("deduction_type_riders").insert({ deduction_type_id: typeId, rider_id: riderId });
    if (error) {
      toast.error(error.message);
      setEnrolledIds(enrolledIds);
    }
  };

  const setEnrolledClient = async (typeId: string, riderId: string, clientId: string) => {
    const prev = enrolledClient.get(riderId) ?? null;
    setEnrolledClientMap(new Map(enrolledClient).set(riderId, clientId || null));
    const { error } = await (supabase as any)
      .from("deduction_type_riders")
      .update({ client_id: clientId || null })
      .eq("deduction_type_id", typeId).eq("rider_id", riderId);
    if (error) {
      toast.error(error.message);
      setEnrolledClientMap(new Map(enrolledClient).set(riderId, prev));
    }
  };

  const toggleAppliesToAll = async (r: DType) => {
    const { error } = await (supabase as any)
      .from("deduction_types")
      .update({ applies_to_all: !r.applies_to_all })
      .eq("id", r.id);
    if (error) return toast.error(error.message);
    load();
  };

  const filteredRiders = riders.filter((r) => {
    const q = riderSearch.trim().toLowerCase();
    return !q || r.full_name.toLowerCase().includes(q) || r.employee_id.toLowerCase().includes(q);
  });

  const load = async () => {
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("deduction_types")
      .select("*")
      .order("name");
    if (error) toast.error(error.message);
    else setRows(data ?? []);
    setLoading(false);
  };
  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    if (!nf.code.trim() || !nf.name.trim()) return toast.error(t("dtypes.errCodeName"));
    if (nf.auto_recurring && nf.recurring_amount <= 0)
      return toast.error(t("dtypes.errRecurringAmount"));
    setSaving(true);
    const { error } = await (supabase as any).from("deduction_types").insert({
      code: nf.code.trim().toUpperCase(),
      name: nf.name.trim(),
      description: nf.description.trim() || null,
      installmentable: nf.installmentable,
      auto_recurring: nf.auto_recurring,
      recurring_amount: nf.auto_recurring ? nf.recurring_amount : 0,
      trigger_frequency: nf.auto_recurring ? nf.trigger_frequency : "every_payroll_run",
      applies_to_all: nf.auto_recurring ? nf.applies_to_all : true,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(t("dtypes.addedToast"));
    setNf({
      code: "",
      name: "",
      description: "",
      installmentable: false,
      auto_recurring: false,
      recurring_amount: 0,
      trigger_frequency: "every_payroll_run",
      applies_to_all: true,
    });
    setAdding(false);
    load();
  };
  const remove = async (r: DType) => {
    if (
      !(await confirmDialog({
        title: t("dtypes.deleteTitle"),
        description: `"${r.name}" ${t("dtypes.deleteDesc")}`,
        confirmText: t("dtypes.delete"),
      }))
    )
      return;
    const { error } = await (supabase as any).from("deduction_types").delete().eq("id", r.id);
    if (!error) {
      toast.success(t("dtypes.deletedToast"));
      return load();
    }
    // Kalau masih dipakai cicilan/potongan tercatat → FK error. Tawarin nonaktifin.
    const inUse = (error as any).code === "23503" || /foreign key/i.test(error.message);
    if (inUse) {
      if (
        await confirmDialog({
          title: t("dtypes.cannotDeleteTitle"),
          description: `"${r.name}" ${t("dtypes.inUseDesc")}`,
          confirmText: t("dtypes.deactivate"),
          danger: false,
        })
      ) {
        const { error: e2 } = await (supabase as any)
          .from("deduction_types")
          .update({ active: false })
          .eq("id", r.id);
        if (e2) return toast.error(e2.message);
        toast.success(t("dtypes.deactivatedToast"));
        load();
      }
      return;
    }
    toast.error(error.message);
  };

  const handleBulkDelete = async () => {
    if (
      !(await confirmDialog({
        title: `${t("dtypes.delete")} ${bulk.count} ${t("dtypes.bulkLabel")}?`,
        description: t("dtypes.bulkDeleteDesc"),
        confirmText: t("dtypes.delete"),
      }))
    )
      return;
    setBulkDeleting(true);
    const { error } = await (supabase as any)
      .from("deduction_types")
      .delete()
      .in("id", [...bulk.selected]);
    setBulkDeleting(false);
    if (error) {
      const inUse = (error as any).code === "23503" || /foreign key/i.test(error.message);
      return toast.error(inUse ? t("dtypes.bulkInUseError") : error.message);
    }
    toast.success(`${bulk.count} ${t("dtypes.bulkLabel")} ${t("dtypes.deletedSuffix")}`);
    bulk.clear();
    load();
  };

  const toggleActive = async (r: DType) => {
    const { error } = await (supabase as any)
      .from("deduction_types")
      .update({ active: !r.active })
      .eq("id", r.id);
    if (error) return toast.error(error.message);
    toast.success(r.active ? t("dtypes.deactivated") : t("dtypes.activated"));
    load();
  };

  const inputCls = "mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm";

  return (
    <div>
      <div className="flex justify-end mb-3">
        <button
          onClick={() => setAdding((v) => !v)}
          className="inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm"
        >
          <Plus className="w-4 h-4" /> {t("dtypes.addButton")}
        </button>
      </div>

      {adding && (
        <div className="rounded-lg border border-border bg-card p-4 mb-3">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium">{t("dtypes.newTitle")}</h3>
            <button
              onClick={() => setAdding(false)}
              className="p-1 text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">{t("dtypes.codeLabel")}</label>
              <input
                value={nf.code}
                onChange={(e) => setNf({ ...nf, code: e.target.value })}
                placeholder={t("dtypes.codePlaceholder")}
                className={inputCls}
              />
            </div>
            <div>
              <label className="text-sm font-medium">{t("dtypes.nameLabel")}</label>
              <input
                value={nf.name}
                onChange={(e) => setNf({ ...nf, name: e.target.value })}
                placeholder={t("dtypes.namePlaceholder")}
                className={inputCls}
              />
            </div>
          </div>
          <div className="mt-3">
            <label className="text-sm font-medium">
              {t("dtypes.descriptionLabel")} <span className="font-normal text-muted-foreground">({t("dtypes.optional")})</span>
            </label>
            <input
              value={nf.description}
              onChange={(e) => setNf({ ...nf, description: e.target.value })}
              className={inputCls}
            />
          </div>
          <label className="flex items-center gap-2 mt-3 text-sm">
            <input
              type="checkbox"
              checked={nf.installmentable}
              onChange={(e) =>
                setNf({
                  ...nf,
                  installmentable: e.target.checked,
                  auto_recurring: e.target.checked ? false : nf.auto_recurring,
                })
              }
            />{" "}
            {t("dtypes.installmentableLabel")}{" "}
            <span className="text-muted-foreground text-xs">
              ({t("dtypes.installmentableHint")})
            </span>
          </label>
          <label className="flex items-center gap-2 mt-2 text-sm">
            <input
              type="checkbox"
              checked={nf.auto_recurring}
              onChange={(e) =>
                setNf({
                  ...nf,
                  auto_recurring: e.target.checked,
                  installmentable: e.target.checked ? false : nf.installmentable,
                })
              }
            />
            {t("dtypes.autoRecurringLabel")}{" "}
            <span className="text-muted-foreground text-xs">({t("dtypes.autoRecurringHint")})</span>
          </label>
          {nf.auto_recurring && (
            <div className="mt-3 space-y-3">
              <div>
                <label className="text-sm font-medium">{t("dtypes.recurringAmountLabel")}</label>
                <input
                  inputMode="numeric"
                  placeholder={t("dtypes.amountPlaceholder")}
                  value={nf.recurring_amount ? nf.recurring_amount.toLocaleString("id-ID") : ""}
                  onChange={(e) => setNf({ ...nf, recurring_amount: parseRupiah(e.target.value) })}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="text-sm font-medium">{t("dtypes.frequencyLabel")}</label>
                <select
                  value={nf.trigger_frequency}
                  onChange={(e) =>
                    setNf({ ...nf, trigger_frequency: e.target.value as "every_payroll_run" | "monthly_once" })
                  }
                  className={inputCls}
                >
                  <option value="every_payroll_run">{t("dtypes.everyRun")}</option>
                  <option value="monthly_once">{t("dtypes.monthlyOnce")}</option>
                </select>
                <p className="text-xs text-muted-foreground mt-1">
                  {t("dtypes.monthlyOnceHint")}
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={nf.applies_to_all}
                  onChange={(e) => setNf({ ...nf, applies_to_all: e.target.checked })}
                />
                {t("dtypes.appliesToAllLabel")}{" "}
                <span className="text-muted-foreground text-xs">
                  ({t("dtypes.appliesToAllHint")})
                </span>
              </label>
            </div>
          )}
          <div className="flex justify-end gap-2 mt-4">
            <button
              onClick={() => setAdding(false)}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-sm hover:bg-muted"
            >
              {t("dtypes.cancel")}
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm disabled:opacity-50"
            >
              {saving ? t("dtypes.saving") : t("dtypes.save")}
            </button>
          </div>
        </div>
      )}

      <div className="rounded-xl border-[3px] border-border-strong bg-card shadow-[6px_6px_0_0_var(--color-border-strong)] overflow-hidden">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-border">
              <th className="p-3 w-8">
                <input
                  type="checkbox"
                  checked={bulk.allSelected}
                  onChange={bulk.toggleAll}
                  className="rounded border-border"
                />
              </th>
              <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-3">
                {t("dtypes.codeLabel")}
              </th>
              <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-3">
                {t("dtypes.nameLabel")}
              </th>
              <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-3">
                {t("dtypes.installmentableCol")}
              </th>
              <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-3">
                {t("dtypes.autoCol")}
              </th>
              <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-3">
                {t("dtypes.statusCol")}
              </th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="p-8 text-center">
                  <Loader2 className="w-4 h-4 animate-spin inline text-primary" />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-muted-foreground text-[11px]">
                  {t("dtypes.emptyState")}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <Fragment key={r.id}>
                <tr
                  className="border-b border-border last:border-b-0 hover:bg-muted/40 transition-colors"
                >
                  <td className="p-3">
                    <input
                      type="checkbox"
                      checked={bulk.selected.has(r.id)}
                      onChange={() => bulk.toggle(r.id)}
                      className="rounded border-border"
                    />
                  </td>
                  <td
                    className="p-3 text-muted-foreground"
                    style={{ fontFamily: "'JetBrains Mono', monospace" }}
                  >
                    {r.code}
                  </td>
                  <td className="p-3 font-medium text-foreground">{r.name}</td>
                  <td className="p-3 text-muted-foreground">
                    {r.installmentable ? t("dtypes.yes") : t("dtypes.no")}
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {r.auto_recurring ? (
                      <div className="space-y-1">
                        <span className="text-primary font-medium block">
                          {t("dtypes.yes")} · Rp{Number(r.recurring_amount).toLocaleString("id-ID")} ·{" "}
                          {r.trigger_frequency === "monthly_once" ? t("dtypes.monthly") : t("dtypes.perRun")}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => toggleAppliesToAll(r)}
                            title={t("dtypes.clickToChange")}
                            className={`text-[10px] font-medium px-2 py-0.5 rounded-full border-2 transition-colors ${r.applies_to_all ? "border-border text-muted-foreground bg-muted hover:bg-muted/70" : "border-border-strong text-primary-foreground bg-primary hover:bg-primary/90"}`}
                          >
                            {r.applies_to_all ? t("dtypes.allRiders") : t("dtypes.specificRiders")}
                          </button>
                          {!r.applies_to_all && (
                            <button
                              onClick={() => openManage(r)}
                              className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-primary"
                            >
                              <Users className="w-3 h-3" /> {t("dtypes.manage")}
                            </button>
                          )}
                        </div>
                      </div>
                    ) : (
                      t("dtypes.no")
                    )}
                  </td>
                  <td className="p-3">
                    <button
                      onClick={() => toggleActive(r)}
                      title={t("dtypes.clickToToggleActive")}
                      className={`text-[10px] font-medium px-2 py-0.5 rounded-full border-2 transition-colors ${r.active ? "border-border-strong bg-success text-success-foreground hover:brightness-105" : "border-border text-muted-foreground bg-muted hover:bg-muted/70"}`}
                    >
                      {r.active ? t("dtypes.active") : t("dtypes.inactive")}
                    </button>
                  </td>
                  <td className="text-right pr-3">
                    <button
                      onClick={() => remove(r)}
                      className="p-1.5 hover:bg-destructive/10 text-muted-foreground hover:text-destructive rounded-md transition-colors"
                      title={t("dtypes.delete")}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
                {managingId === r.id && (
                  <tr className="border-b border-border/60 bg-muted/20">
                    <td colSpan={7} className="p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium">
                          {t("dtypes.ridersAffected")} "{r.name}" ({enrolledIds.size} {t("dtypes.selectedSuffix")})
                        </span>
                        <button
                          onClick={() => setManagingId(null)}
                          className="p-1 text-muted-foreground hover:text-foreground"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <input
                        placeholder={t("dtypes.searchRiderPlaceholder")}
                        value={riderSearch}
                        onChange={(e) => setRiderSearch(e.target.value)}
                        className="w-full max-w-sm rounded-md border-2 border-border-strong bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
                      />
                      <div className="mt-2 max-h-56 max-w-sm overflow-y-auto rounded-md border-2 border-border-strong divide-y divide-border">
                        {filteredRiders.length === 0 ? (
                          <div className="px-3 py-2 text-muted-foreground text-xs">{t("dtypes.noRidersFound")}</div>
                        ) : (
                          filteredRiders.map((rd) => (
                            <div
                              key={rd.id}
                              className="flex items-center gap-2.5 px-3 py-2 hover:bg-muted text-sm"
                            >
                              <label className="flex items-center gap-2.5 flex-1 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={enrolledIds.has(rd.id)}
                                  onChange={() => toggleEnrolled(r.id, rd.id)}
                                />
                                <span className="font-mono text-xs text-muted-foreground">{rd.employee_id}</span>
                                <span>{rd.full_name}</span>
                              </label>
                              {enrolledIds.has(rd.id) && (
                                <select
                                  value={enrolledClient.get(rd.id) ?? ""}
                                  onChange={(e) => setEnrolledClient(r.id, rd.id, e.target.value)}
                                  className="rounded-md border-2 border-border-strong bg-background px-1.5 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                                  title={t("dtypes.clientPriorityTitle")}
                                >
                                  <option value="">{t("dtypes.homeClientOption")}</option>
                                  {clients.map((c) => (
                                    <option key={c.id} value={c.id}>
                                      {c.name}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>
      <BulkActionBar
        count={bulk.count}
        label={t("dtypes.bulkLabel")}
        deleting={bulkDeleting}
        onDelete={handleBulkDelete}
        onClear={bulk.clear}
      />
    </div>
  );
}
