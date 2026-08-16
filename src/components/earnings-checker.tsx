import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatRupiah } from "@/lib/format";
import { BadgeCheck, Download, FileText, Loader2, Search } from "lucide-react";
import { EarningsRecapPrint } from "@/components/earnings-recap-print";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

type PublishedClient = { client_id: string; client_name: string; orders: number; gross: number };
type PublishedSummary = { slips: number; orders: number; gross: number; deduction: number; net: number; clients: PublishedClient[] };

export function EarningsChecker({ riderId, riderReady, riderName, employeeId }: { riderId: string; riderReady: boolean; riderName: string; employeeId: string }) {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const [from, setFrom] = useState(`${y}-${m}-01`);
  const [to, setTo] = useState(`${y}-${m}-${String(today.getDate()).padStart(2, "0")}`);
  const [published, setPublished] = useState<PublishedSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRecapPrint, setShowRecapPrint] = useState(false);

  async function check() {
    if (!riderReady || !from || !to) return;
    setLoading(true);
    setError(null);
    const { data: payslipData, error: payslipError } = await sb
      .from("payslips")
      .select("detail_id, data, payroll_runs(period_start, period_end)")
      .eq("rider_id", riderId);
    if (payslipError) {
      setError("Rekap payslip resmi belum bisa dimuat. Coba lagi sebentar.");
      setPublished(null);
      setLoading(false);
      return;
    }
    const selectedSlips = (payslipData ?? [])
      .filter((slip: { payroll_runs: { period_start: string; period_end: string } | null }) => {
        const period = slip.payroll_runs;
        return period && period.period_start >= from && period.period_end <= to;
      });
    const detailIds = selectedSlips.map((slip: { detail_id: string }) => slip.detail_id).filter(Boolean);
    const { data: details, error: detailsError } = detailIds.length
      ? await sb.from("payroll_details").select("id, client_id, clients(name)").in("id", detailIds)
      : { data: [], error: null };
    if (detailsError) {
      setError("Rekap payslip resmi belum bisa dimuat. Coba lagi sebentar.");
      setPublished(null);
      setLoading(false);
      return;
    }
    const detailMap = new Map((details ?? []).map((detail: { id: string; client_id: string; clients: { name: string } | null }) => [detail.id, detail]));
    const byClient = new Map<string, PublishedClient>();
    const summary = selectedSlips.reduce(
        (acc: PublishedSummary, slip: { data: { delivery_count?: number; gross_earning?: number; total_deduction?: number; net_pay?: number } }) => ({
          slips: acc.slips + 1,
          orders: acc.orders + Number(slip.data?.delivery_count ?? 0),
          gross: acc.gross + Number(slip.data?.gross_earning ?? 0),
          deduction: acc.deduction + Number(slip.data?.total_deduction ?? 0),
          net: acc.net + Number(slip.data?.net_pay ?? 0),
          clients: acc.clients,
        }),
        { slips: 0, orders: 0, gross: 0, deduction: 0, net: 0, clients: [] },
      );
    for (const slip of selectedSlips as { detail_id: string; data: { delivery_count?: number; gross_earning?: number } }[]) {
      const detail = detailMap.get(slip.detail_id);
      const clientId = detail?.client_id ?? "_unknown";
      const client = byClient.get(clientId) ?? { client_id: clientId, client_name: detail?.clients?.name ?? "Tanpa Client", orders: 0, gross: 0 };
      client.orders += Number(slip.data?.delivery_count ?? 0);
      client.gross += Number(slip.data?.gross_earning ?? 0);
      byClient.set(clientId, client);
    }
    summary.clients = [...byClient.values()].sort((a, b) => b.gross - a.gross);
    setPublished(summary);
    setLoading(false);
  }

  return (
    <div className="mb-5 rounded-2xl border-2 border-border-strong bg-card p-4 shadow-[5px_5px_0_0_var(--color-border-strong)]">
      <div className="flex items-center gap-2 mb-3"><span className="w-8 h-8 rounded-xl bg-primary/10 text-primary grid place-items-center"><Search className="w-4 h-4" /></span><div><p className="text-sm font-semibold">Cek Pendapatan</p><p className="text-[10px] text-muted-foreground">Payslip resmi pada periode pilihan</p></div></div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[120px]">
          <label className="text-[10px] text-muted-foreground">Dari</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="w-full rounded-md border-2 border-border-strong bg-background px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-ring" />
        </div>
        <div className="flex-1 min-w-[120px]">
          <label className="text-[10px] text-muted-foreground">Sampai</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="w-full rounded-md border-2 border-border-strong bg-background px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-ring" />
        </div>
        <button onClick={check} disabled={loading || !riderReady}
          className="px-4 py-2 rounded-xl border-2 border-border-strong bg-primary text-primary-foreground text-xs font-bold disabled:opacity-50 disabled:shadow-none shadow-[3px_3px_0_0_var(--color-border-strong)] hover:brightness-105 active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-[filter,transform,box-shadow]">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Lihat"}
        </button>
      </div>
      {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
      {published !== null && (
        <div className="mt-4 space-y-3">
          {published.slips > 0 ? (
            <div className="rounded-2xl border-2 border-border-strong bg-success/10 p-4">
              <div className="flex items-start gap-2"><BadgeCheck className="w-4 h-4 text-success mt-0.5 flex-shrink-0" /><div><p className="text-[10px] font-semibold tracking-[.13em] uppercase text-success">Pendapatan bersih final</p><p className="text-[11px] text-muted-foreground mt-1">{published.slips} payslip resmi · {published.orders} order · dasar pengajuan cicilan</p></div></div>
              <div className="grid grid-cols-3 gap-2 mt-4 border-t border-success/20 pt-3 text-center"><div><span className="block text-[10px] text-muted-foreground">Gross</span><b className="block mt-1 text-[11px] tabular-nums">{formatRupiah(published.gross)}</b></div><div><span className="block text-[10px] text-muted-foreground">Potongan</span><b className="block mt-1 text-[11px] text-warning tabular-nums">{formatRupiah(published.deduction)}</b></div><div><span className="block text-[10px] text-muted-foreground">Bersih</span><b className="block mt-1 text-[11px] text-success tabular-nums">{formatRupiah(published.net)}</b></div></div>
              <button onClick={() => setShowRecapPrint(true)} className="mt-4 w-full inline-flex items-center justify-center gap-2 rounded-xl bg-success px-3 py-2.5 text-xs font-semibold text-success-foreground shadow-sm"><Download className="w-4 h-4" />Unduh Rekap Penghasilan Final</button>
            </div>
          ) : (
            <div className="flex gap-2 rounded-xl bg-muted/60 p-3 text-[11px] text-muted-foreground"><FileText className="w-4 h-4 flex-shrink-0" />Belum ada payroll yang terbit untuk periode ini.</div>
          )}
        </div>
      )}
      {showRecapPrint && published !== null && (
        <EarningsRecapPrint from={from} to={to} riderName={riderName} employeeId={employeeId} published={published} onClose={() => setShowRecapPrint(false)} />
      )}
    </div>
  );
}
