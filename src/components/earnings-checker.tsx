import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatRupiah } from "@/lib/format";
import { BadgeCheck, FileText, Loader2, Search } from "lucide-react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

type Row = { client_id: string; client_name: string; count: number; total: number };
type PublishedSummary = { slips: number; orders: number; gross: number; deduction: number; net: number };

export function EarningsChecker({ riderId, riderReady }: { riderId: string; riderReady: boolean }) {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const [from, setFrom] = useState(`${y}-${m}-01`);
  const [to, setTo] = useState(`${y}-${m}-${String(today.getDate()).padStart(2, "0")}`);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [published, setPublished] = useState<PublishedSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function check() {
    if (!riderReady || !from || !to) return;
    setLoading(true);
    setError(null);
    const [{ data, error: deliveryError }, { data: payslipData, error: payslipError }] = await Promise.all([
      sb
        .from("delivery_records")
        .select("client_id, fee, clients(name)")
        .eq("rider_id", riderId)
        .eq("status", "COMPLETED")
        .gte("delivery_date", from)
        .lte("delivery_date", to),
      sb
        .from("payslips")
        .select("data, payroll_runs(period_start, period_end)")
        .eq("rider_id", riderId),
    ]);
    if (deliveryError || payslipError) {
      setError("Rekap periode belum bisa dimuat. Coba lagi sebentar.");
      setRows(null);
      setPublished(null);
      setLoading(false);
      return;
    }
    const map = new Map<string, { client_name: string; count: number; total: number }>();
    for (const r of data ?? []) {
      const cid = r.client_id ?? "_none";
      const cur = map.get(cid) ?? { client_name: r.clients?.name ?? "Tanpa Client", count: 0, total: 0 };
      cur.count++;
      cur.total += Number(r.fee ?? 0);
      map.set(cid, cur);
    }
    setRows(Array.from(map, ([client_id, v]) => ({ client_id, ...v })).sort((a, b) => b.total - a.total));
    const summary = (payslipData ?? [])
      .filter((slip: { payroll_runs: { period_start: string; period_end: string } | null }) => {
        const period = slip.payroll_runs;
        return period && period.period_start >= from && period.period_end <= to;
      })
      .reduce(
        (acc: PublishedSummary, slip: { data: { delivery_count?: number; gross_earning?: number; total_deduction?: number; net_pay?: number } }) => ({
          slips: acc.slips + 1,
          orders: acc.orders + Number(slip.data?.delivery_count ?? 0),
          gross: acc.gross + Number(slip.data?.gross_earning ?? 0),
          deduction: acc.deduction + Number(slip.data?.total_deduction ?? 0),
          net: acc.net + Number(slip.data?.net_pay ?? 0),
        }),
        { slips: 0, orders: 0, gross: 0, deduction: 0, net: 0 },
      );
    setPublished(summary);
    setLoading(false);
  }

  const grand = rows?.reduce((s, r) => s + r.total, 0) ?? 0;
  const grandCount = rows?.reduce((s, r) => s + r.count, 0) ?? 0;

  return (
    <div className="mb-5 rounded-2xl border border-border bg-card/80 p-4 shadow-sm dark:bg-white/[.035]">
      <div className="flex items-center gap-2 mb-3"><span className="w-8 h-8 rounded-xl bg-primary/10 text-primary grid place-items-center"><Search className="w-4 h-4" /></span><div><p className="text-sm font-semibold">Cek Pendapatan</p><p className="text-[10px] text-muted-foreground">Akumulasi semua client pada periode pilihan</p></div></div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[120px]">
          <label className="text-[10px] text-muted-foreground">Dari</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs" />
        </div>
        <div className="flex-1 min-w-[120px]">
          <label className="text-[10px] text-muted-foreground">Sampai</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs" />
        </div>
        <button onClick={check} disabled={loading || !riderReady}
          className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-50 shadow-sm shadow-primary/25">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Lihat"}
        </button>
      </div>
      {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
      {rows !== null && published !== null && (
        <div className="mt-4 space-y-3">
          <div className="rounded-2xl border border-primary/25 bg-primary-soft/35 p-4 dark:bg-primary/10">
            <div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-semibold tracking-[.13em] uppercase text-primary">Akumulasi order selesai</p><p className="text-[11px] text-muted-foreground mt-1">Semua client · {grandCount} order</p></div><span className="text-lg font-bold text-primary tabular-nums">{formatRupiah(grand)}</span></div>
          </div>
          {rows.length === 0 ? (
            <p className="text-xs text-muted-foreground">Tidak ada delivery di periode ini.</p>
          ) : (
            <div className="rounded-xl border border-border divide-y divide-border/70 px-3">
              {rows.map((r) => (
                <div key={r.client_id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <span className="text-xs truncate">{r.client_name}</span>
                    <span className="text-[10px] text-muted-foreground ml-1.5">{r.count} order</span>
                  </div>
                  <span className="text-xs font-semibold flex-shrink-0">{formatRupiah(r.total)}</span>
                </div>
              ))}
            </div>
          )}
          {published.slips > 0 ? (
            <div className="rounded-2xl border border-success/25 bg-success/10 p-4">
              <div className="flex items-start gap-2"><BadgeCheck className="w-4 h-4 text-success mt-0.5 flex-shrink-0" /><div><p className="text-[10px] font-semibold tracking-[.13em] uppercase text-success">Rekap payslip terbit</p><p className="text-[11px] text-muted-foreground mt-1">{published.slips} payslip resmi · {published.orders} order · dasar pengajuan cicilan</p></div></div>
              <div className="grid grid-cols-3 gap-2 mt-4 border-t border-success/20 pt-3 text-center"><div><span className="block text-[10px] text-muted-foreground">Gross</span><b className="block mt-1 text-[11px] tabular-nums">{formatRupiah(published.gross)}</b></div><div><span className="block text-[10px] text-muted-foreground">Potongan</span><b className="block mt-1 text-[11px] text-warning tabular-nums">{formatRupiah(published.deduction)}</b></div><div><span className="block text-[10px] text-muted-foreground">Bersih</span><b className="block mt-1 text-[11px] text-success tabular-nums">{formatRupiah(published.net)}</b></div></div>
            </div>
          ) : (
            <div className="flex gap-2 rounded-xl bg-muted/60 p-3 text-[11px] text-muted-foreground"><FileText className="w-4 h-4 flex-shrink-0" />Belum ada payslip terbit penuh dalam periode ini. Akumulasi fee di atas masih pendapatan berjalan, bukan bukti penghasilan final.</div>
          )}
        </div>
      )}
    </div>
  );
}
