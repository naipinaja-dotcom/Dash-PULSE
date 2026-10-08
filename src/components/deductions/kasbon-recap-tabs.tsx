import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { toCSV, downloadCSV } from "@/lib/csv";
import { useT } from "@/lib/i18n";
import { PageSizeSelect, PaginationBar } from "@/components/pagination-bar";
import { usePagination } from "@/lib/use-pagination";

const sb = supabase as any;
const rp = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;
type Settlement = { id: string; recipient: string; bank: string; account: string; rider: string; amount: number; period: string; status: string };

export function KasbonSettlementTab() {
  const { t } = useT();
  const [rows, setRows] = useState<Settlement[]>([]); const [loading, setLoading] = useState(true);
  const { pageSize, setPageSize, page, setPage, totalPages, paged, from, to, total } = usePagination(rows, 10);
  useEffect(() => { (async () => { const { data, error } = await sb.from("payroll_deductions").select("id, paid_amount, kasbon_recipient_id, deduction_types(code), payroll_runs:payroll_details(run_id, riders(full_name), payroll_runs(name, status, period_start, period_end)), kasbon_recipients(name, bank_name, account_number)"); if (error) { if (error.code !== "42P01") toast.error(error.message); setLoading(false); return; } const out = (data ?? []).filter((x: any) => x.deduction_types?.code === "KASBON" && Number(x.paid_amount ?? 0) > 0 && x.payroll_runs?.payroll_runs?.status === "published").map((x: any) => ({ id: x.id, recipient: x.kasbon_recipients?.name ?? t("kasbonsettle.recipientUnmapped"), bank: x.kasbon_recipients?.bank_name ?? "—", account: x.kasbon_recipients?.account_number ?? "—", rider: x.payroll_runs?.riders?.full_name ?? "—", amount: Number(x.paid_amount), period: x.payroll_runs?.payroll_runs?.name ?? "—", status: x.kasbon_recipients ? "Siap ditransfer" : "Belum lengkap" })); setRows(out); setLoading(false); })(); }, [t]);
  const exportFile = () => downloadCSV("settlement-kasbon.csv", toCSV([[t("kasbonsettle.colRecipient"), t("kasbonsettle.colBank"), t("kasbonsettle.colAccount"), t("kasbonsettle.colRider"), t("kasbonsettle.colAmountCollected"), t("kasbonsettle.colPayroll"), t("kasbonsettle.colStatus")], ...rows.map(r => [r.recipient, r.bank, r.account, r.rider, r.amount, r.period, r.status])]));
  if (loading) return <Loader2 className="w-4 h-4 animate-spin" />;
  return <div className="space-y-3"><div className="flex items-center justify-end gap-3"><PageSizeSelect pageSize={pageSize} setPageSize={setPageSize} /><button disabled={!rows.length} onClick={exportFile} className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"><Download className="w-4 h-4" /> {t("kasbonsettle.exportBtn")}</button></div><div className="rounded-xl border border-border overflow-x-auto"><table className="w-full text-sm"><thead className="bg-muted text-left"><tr><th className="p-3">{t("kasbonsettle.colRecipient")}</th><th>{t("kasbonsettle.colAccount")}</th><th>{t("kasbonsettle.colRider")}</th><th>{t("kasbonsettle.colPayroll")}</th><th className="text-right">{t("kasbonsettle.colCollected")}</th><th>{t("kasbonsettle.colStatus")}</th></tr></thead><tbody>{paged.length ? paged.map(r => <tr key={r.id} className="border-t border-border"><td className="p-3 font-medium">{r.recipient}</td><td>{r.bank} · {r.account}</td><td>{r.rider}</td><td>{r.period}</td><td className="text-right font-semibold">{rp(r.amount)}</td><td className={r.status === "Siap ditransfer" ? "text-success" : "text-warning"}>{r.status}</td></tr>) : <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">{t("kasbonsettle.emptyState")}</td></tr>}</tbody></table></div>{total > 0 && <PaginationBar page={page} totalPages={totalPages} setPage={setPage} from={from} to={to} total={total} />}</div>;
}

type Lunas = { id: string; rider: string; employeeId: string; recipient: string; total: number; paid: number; count: number; start: string; lastPaid: string };

// Kasbon lunas = cicilan KASBON yang udah nonaktif DAN punya riwayat bayar
// (paid_amount > 0 di payroll_deductions). Tanggal bayar terakhir diambil dari
// period_end run payroll terakhir yang motong kasbon itu.
export function KasbonLunasTab() {
  const { t } = useT();
  const [rows, setRows] = useState<Lunas[]>([]); const [loading, setLoading] = useState(true);
  useEffect(() => { (async () => {
    const { data: ins, error } = await sb.from("rider_installments").select("id, total_amount, installment_count, start_date, kasbon_recipient_id, riders(full_name, employee_id), deduction_types!inner(code)").eq("active", false).eq("deduction_types.code", "KASBON");
    if (error) { toast.error(error.message); setLoading(false); return; }
    const ids = (ins ?? []).map((i: any) => i.id);
    if (!ids.length) { setRows([]); setLoading(false); return; }
    const [{ data: deds }, { data: recs }] = await Promise.all([
      sb.from("payroll_deductions").select("installment_id, paid_amount, payroll_details(payroll_runs(period_end))").in("installment_id", ids),
      sb.from("kasbon_recipients").select("id, name"),
    ]);
    const recName = new Map((recs ?? []).map((r: any) => [r.id, r.name]));
    const paidBy = new Map<string, { paid: number; last: string }>();
    for (const d of deds ?? []) {
      const paid = Number(d.paid_amount ?? 0); if (paid <= 0) continue;
      const end: string = d.payroll_details?.payroll_runs?.period_end ?? "";
      const cur = paidBy.get(d.installment_id) ?? { paid: 0, last: "" };
      cur.paid += paid; if (end > cur.last) cur.last = end; paidBy.set(d.installment_id, cur);
    }
    const out: Lunas[] = (ins ?? []).filter((i: any) => paidBy.has(i.id)).map((i: any) => ({
      id: i.id, rider: i.riders?.full_name ?? "—", employeeId: i.riders?.employee_id ?? "—",
      recipient: (i.kasbon_recipient_id && recName.get(i.kasbon_recipient_id)) || "—",
      total: Number(i.total_amount ?? 0), paid: paidBy.get(i.id)!.paid, count: Number(i.installment_count ?? 0),
      start: i.start_date ?? "—", lastPaid: paidBy.get(i.id)!.last || "—",
    })).sort((a: Lunas, b: Lunas) => (b.lastPaid > a.lastPaid ? 1 : -1));
    setRows(out); setLoading(false);
  })(); }, []);
  const totalPaid = rows.reduce((s, r) => s + r.paid, 0);
  const exportFile = () => downloadCSV("kasbon-lunas.csv", toCSV([[t("kasbonlunas.colRider"), "Kode Mitra", t("kasbonlunas.colRecipient"), t("kasbonlunas.colTotal"), t("kasbonlunas.colPaid"), t("kasbonlunas.colInstallments"), t("kasbonlunas.colStart"), t("kasbonlunas.colLastPaid")], ...rows.map(r => [r.rider, r.employeeId, r.recipient, r.total, r.paid, r.count, r.start, r.lastPaid])]));
  if (loading) return <Loader2 className="w-4 h-4 animate-spin" />;
  if (!rows.length) return <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{t("kasbonlunas.emptyState")}</div>;
  return <div className="space-y-3">
    <div className="flex items-center justify-between gap-3"><div className="text-sm text-muted-foreground"><b className="text-foreground">{rows.length}</b> {t("kasbonlunas.summary")} · {t("kasbonlunas.colPaid")} <b className="text-foreground">{rp(totalPaid)}</b></div><button onClick={exportFile} className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"><Download className="w-4 h-4" /> {t("kasbonlunas.exportBtn")}</button></div>
    <div className="rounded-xl border border-border overflow-x-auto"><table className="w-full text-sm"><thead className="bg-muted text-left"><tr><th className="p-3">{t("kasbonlunas.colRider")}</th><th>{t("kasbonlunas.colRecipient")}</th><th className="text-right">{t("kasbonlunas.colTotal")}</th><th className="text-right">{t("kasbonlunas.colPaid")}</th><th className="text-right">{t("kasbonlunas.colInstallments")}</th><th>{t("kasbonlunas.colStart")}</th><th>{t("kasbonlunas.colLastPaid")}</th></tr></thead><tbody>{rows.map(r => <tr key={r.id} className="border-t border-border"><td className="p-3"><div className="font-medium">{r.rider}</div><div className="text-xs text-muted-foreground">{r.employeeId}</div></td><td>{r.recipient}</td><td className="text-right">{rp(r.total)}</td><td className="text-right font-semibold">{rp(r.paid)}</td><td className="text-right">{r.count || "—"}</td><td>{r.start}</td><td>{r.lastPaid}</td></tr>)}</tbody></table></div>
  </div>;
}
