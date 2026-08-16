import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { parseRupiah } from "@/lib/format";
import { confirmDialog } from "@/components/confirm-dialog";
import { toast } from "sonner";
import { Plus, Trash2, Loader2, X } from "lucide-react";
import type { MolisType } from "./types";
import { useT } from "@/lib/i18n";

export function MolisTypesTab() {
  const { t } = useT();
  const [rows, setRows] = useState<MolisType[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [nf, setNf] = useState({ name: "", default_daily_rate: 0 });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await (supabase as any).from("molis_types").select("*").order("name");
    if (error) toast.error(error.message);
    else setRows(data ?? []);
    setLoading(false);
  };
  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    if (!nf.name.trim()) return toast.error(t("molistypes.nameRequired"));
    if (nf.default_daily_rate <= 0) return toast.error(t("molistypes.rateRequired"));
    setSaving(true);
    const { error } = await (supabase as any).from("molis_types").insert({
      name: nf.name.trim(),
      default_daily_rate: nf.default_daily_rate,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(t("molistypes.added"));
    setNf({ name: "", default_daily_rate: 0 });
    setAdding(false);
    load();
  };

  const remove = async (r: MolisType) => {
    if (
      !(await confirmDialog({
        title: t("molistypes.deleteTitle"),
        description: `"${r.name}" ${t("molistypes.deleteDesc")}`,
        confirmText: t("molistypes.deleteAction"),
      }))
    )
      return;
    const { error } = await (supabase as any).from("molis_types").delete().eq("id", r.id);
    if (!error) {
      toast.success(t("molistypes.deleted"));
      return load();
    }
    const inUse = (error as any).code === "23503" || /foreign key/i.test(error.message);
    if (inUse) {
      if (
        await confirmDialog({
          title: t("molistypes.cannotDeleteTitle"),
          description: `"${r.name}" ${t("molistypes.cannotDeleteDesc")}`,
          confirmText: t("molistypes.deactivate"),
          danger: false,
        })
      ) {
        const { error: e2 } = await (supabase as any)
          .from("molis_types")
          .update({ active: false })
          .eq("id", r.id);
        if (e2) return toast.error(e2.message);
        toast.success(t("molistypes.typeDeactivated"));
        load();
      }
      return;
    }
    toast.error(error.message);
  };

  const toggleActive = async (r: MolisType) => {
    const { error } = await (supabase as any)
      .from("molis_types")
      .update({ active: !r.active })
      .eq("id", r.id);
    if (error) return toast.error(error.message);
    toast.success(r.active ? t("molistypes.statusDeactivated") : t("molistypes.statusActivated"));
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
          <Plus className="w-4 h-4" /> {t("molistypes.addType")}
        </button>
      </div>

      {adding && (
        <div className="rounded-lg border border-border bg-card p-4 mb-3">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium">{t("molistypes.newType")}</h3>
            <button
              onClick={() => setAdding(false)}
              className="p-1 text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">{t("molistypes.nameLabel")}</label>
              <input
                value={nf.name}
                onChange={(e) => setNf({ ...nf, name: e.target.value })}
                placeholder={t("molistypes.namePlaceholder")}
                className={inputCls}
              />
            </div>
            <div>
              <label className="text-sm font-medium">{t("molistypes.defaultDailyRateLabel")}</label>
              <input
                inputMode="numeric"
                placeholder={t("molistypes.ratePlaceholder")}
                value={nf.default_daily_rate ? nf.default_daily_rate.toLocaleString("id-ID") : ""}
                onChange={(e) => setNf({ ...nf, default_daily_rate: parseRupiah(e.target.value) })}
                className={inputCls}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">{t("molistypes.rateHint")}</p>
          <div className="flex justify-end gap-2 mt-4">
            <button
              onClick={() => setAdding(false)}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-sm hover:bg-muted"
            >
              {t("molistypes.cancel")}
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm disabled:opacity-50"
            >
              {saving ? t("molistypes.saving") : t("molistypes.save")}
            </button>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-3">
                {t("molistypes.nameLabel")}
              </th>
              <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-3">
                {t("molistypes.defaultDailyRateCol")}
              </th>
              <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-3">
                {t("molistypes.statusCol")}
              </th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="p-8 text-center">
                  <Loader2 className="w-4 h-4 animate-spin inline text-primary" />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="p-8 text-center text-muted-foreground text-[11px]">
                  {t("molistypes.noTypes")}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-border last:border-b-0 hover:bg-muted/40 transition-colors"
                >
                  <td className="p-3 font-medium text-foreground">{r.name}</td>
                  <td className="p-3 text-muted-foreground font-mono">
                    Rp{Number(r.default_daily_rate).toLocaleString("id-ID")}/{t("molistypes.perDay")}
                  </td>
                  <td className="p-3">
                    <button
                      onClick={() => toggleActive(r)}
                      title={t("molistypes.toggleActiveTitle")}
                      className={`text-[10px] font-medium px-2 py-0.5 rounded-full border transition-colors ${r.active ? "border-success/40 text-success bg-success/10 hover:bg-success/20" : "border-border text-muted-foreground bg-muted hover:bg-muted/70"}`}
                    >
                      {r.active ? t("molistypes.statusActive") : t("molistypes.statusInactive")}
                    </button>
                  </td>
                  <td className="text-right pr-3">
                    <button
                      onClick={() => remove(r)}
                      className="p-1.5 hover:bg-destructive/10 text-muted-foreground hover:text-destructive rounded-md transition-colors"
                      title={t("molistypes.deleteAction")}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
