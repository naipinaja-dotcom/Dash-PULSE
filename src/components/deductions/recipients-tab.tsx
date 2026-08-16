import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, Save, Trash2 } from "lucide-react";
import { useT } from "@/lib/i18n";

type Recipient = { id: string; name: string; bank_name: string; account_number: string; account_holder: string; notes: string | null; no_transfer_needed?: boolean };
const empty = { name: "", bank_name: "", account_number: "", account_holder: "", notes: "", no_transfer_needed: false };

export function RecipientsTab() {
  const { t } = useT();
  const [rows, setRows] = useState<Recipient[]>([]);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const load = async () => {
    const { data, error } = await (supabase as any).from("kasbon_recipients").select("*").order("name");
    if (error) { if (error.code !== "42P01") toast.error(error.message); return; }
    setRows(data ?? []);
  };
  useEffect(() => { load(); }, []);
  const save = async () => {
    if (!form.name.trim() || !form.bank_name.trim() || !form.account_number.trim() || !form.account_holder.trim()) return toast.error(t("kasbonrecip.validationError"));
    setSaving(true);
    const { error } = await (supabase as any).from("kasbon_recipients").insert({ ...form, notes: form.notes || null });
    setSaving(false);
    if (error) return toast.error(error.message);
    setForm(empty); await load(); toast.success(t("kasbonrecip.addSuccess"));
  };
  const remove = async (id: string) => {
    const { error } = await (supabase as any).from("kasbon_recipients").update({ active: false }).eq("id", id);
    if (error) return toast.error(error.message); await load();
  };
  // Rekening internal perusahaan (rider ngasbon KE perusahaan, bukan pihak
  // ke-3 beneran) — potongannya tetap sah tapi gak perlu masuk file transfer
  // bank (lihat fetchKasbonRecipientRows di admin.payroll.tsx).
  const toggleNoTransfer = async (r: Recipient) => {
    const { error } = await (supabase as any).from("kasbon_recipients").update({ no_transfer_needed: !r.no_transfer_needed }).eq("id", r.id);
    if (error) return toast.error(error.message); await load();
  };
  const fieldKeys = [['name','kasbonrecip.recipientNameLabel'],['bank_name','kasbonrecip.bank'],['account_number','kasbonrecip.accountNumber'],['account_holder','kasbonrecip.accountHolderLabel'],['notes','kasbonrecip.notes']] as const;
  return <div className="space-y-5 max-w-4xl">
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 mb-3"><Plus className="w-4 h-4 text-primary" /><h3 className="font-semibold">{t("kasbonrecip.formTitle")}</h3></div>
      <div className="grid gap-3 sm:grid-cols-2">
        {fieldKeys.map(([key,labelKey]) => <label key={key} className="text-xs font-medium">{t(labelKey)}<input value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" placeholder={t(labelKey)} /></label>)}
      </div>
      <label className="mt-3 flex items-center gap-2 text-xs font-medium">
        <input type="checkbox" checked={form.no_transfer_needed} onChange={e => setForm({ ...form, no_transfer_needed: e.target.checked })} />
        {t("kasbonrecip.internalAccountCheckbox")}
      </label>
      <button onClick={save} disabled={saving} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"><Save className="w-4 h-4" /> {t("kasbonrecip.saveBtn")}</button>
    </div>
    <div className="rounded-xl border border-border overflow-x-auto"><table className="w-full text-sm"><thead className="bg-muted text-left"><tr><th className="p-3">{t("kasbonrecip.colRecipient")}</th><th>{t("kasbonrecip.bank")}</th><th>{t("kasbonrecip.accountNumber")}</th><th>{t("kasbonrecip.colAccountName")}</th><th>{t("kasbonrecip.colInternal")}</th><th /></tr></thead><tbody>{rows.filter(r => r.active !== false).map(r => <tr key={r.id} className="border-t border-border"><td className="p-3 font-medium">{r.name}</td><td>{r.bank_name}</td><td className="font-mono">{r.account_number}</td><td>{r.account_holder}</td><td><button onClick={() => toggleNoTransfer(r)} className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${r.no_transfer_needed ? "bg-primary-soft text-primary-soft-foreground" : "bg-muted text-muted-foreground"}`} title={t("kasbonrecip.toggleStatusTooltip")}>{r.no_transfer_needed ? t("kasbonrecip.internalBadge") : t("kasbonrecip.externalBadge")}</button></td><td className="text-right pr-3"><button onClick={() => remove(r.id)} className="text-destructive hover:opacity-70" title={t("kasbonrecip.deactivateTooltip")}><Trash2 className="w-4 h-4" /></button></td></tr>)}</tbody></table></div>
  </div>;
}
