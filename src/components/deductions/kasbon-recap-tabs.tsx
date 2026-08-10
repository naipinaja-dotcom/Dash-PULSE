import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { toCSV, downloadCSV } from "@/lib/csv";

const sb = supabase as any;
const rp = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;
type Settlement = { id: string; recipient: string; bank: string; account: string; rider: string; amount: number; period: string; status: string };

export function KasbonSettlementTab() {
  const [rows, setRows] = useState<Settlement[]>([]); const [loading, setLoading] = useState(true);
  useEffect(() => { (async () => { const { data, error } = await sb.from("payroll_deductions").select("id, paid_amount, kasbon_recipient_id, deduction_types(code), payroll_runs:payroll_details(run_id, riders(full_name), payroll_runs(name, status, period_start, period_end)), kasbon_recipients(name, bank_name, account_number)"); if (error) { if (error.code !== "42P01") toast.error(error.message); setLoading(false); return; } const out = (data ?? []).filter((x: any) => x.deduction_types?.code === "KASBON" && Number(x.paid_amount ?? 0) > 0 && x.payroll_runs?.payroll_runs?.status === "published").map((x: any) => ({ id: x.id, recipient: x.kasbon_recipients?.name ?? "Belum dipetakan", bank: x.kasbon_recipients?.bank_name ?? "—", account: x.kasbon_recipients?.account_number ?? "—", rider: x.payroll_runs?.riders?.full_name ?? "—", amount: Number(x.paid_amount), period: x.payroll_runs?.payroll_runs?.name ?? "—", status: x.kasbon_recipients ? "Siap ditransfer" : "Belum lengkap" })); setRows(out); setLoading(false); })(); }, []);
  const exportFile = () => downloadCSV("settlement-kasbon.csv", toCSV([["Penerima", "Bank", "Rekening", "Rider", "Nominal Tertagih", "Payroll", "Status"], ...rows.map(r => [r.recipient, r.bank, r.account, r.rider, r.amount, r.period, r.status])]));
  if (loading) return <Loader2 className="w-4 h-4 animate-spin" />;
  return <div className="space-y-3"><div className="flex justify-end"><button disabled={!rows.length} onClick={exportFile} className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"><Download className="w-4 h-4" /> Export Settlement</button></div><div className="rounded-xl border border-border overflow-x-auto"><table className="w-full text-sm"><thead className="bg-muted text-left"><tr><th className="p-3">Penerima</th><th>Rekening</th><th>Rider</th><th>Payroll</th><th className="text-right">Tertagih</th><th>Status</th></tr></thead><tbody>{rows.length ? rows.map(r => <tr key={r.id} className="border-t border-border"><td className="p-3 font-medium">{r.recipient}</td><td>{r.bank} · {r.account}</td><td>{r.rider}</td><td>{r.period}</td><td className="text-right font-semibold">{rp(r.amount)}</td><td className={r.status === "Siap ditransfer" ? "text-success" : "text-warning"}>{r.status}</td></tr>) : <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">Belum ada kasbon tertagih dari payroll published.</td></tr>}</tbody></table></div></div>;
}

export function KasbonLunasTab() { return <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Recap kasbon lunas akan muncul setelah data cicilan berstatus inactive memiliki riwayat paid_amount.</div>; }
