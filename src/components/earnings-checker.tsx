import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatRupiah } from "@/lib/format";
import { Loader2, Search } from "lucide-react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

type Row = { client_id: string; client_name: string; count: number; total: number };

export function EarningsChecker({ riderId, riderReady }: { riderId: string; riderReady: boolean }) {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const [from, setFrom] = useState(`${y}-${m}-01`);
  const [to, setTo] = useState(`${y}-${m}-${String(today.getDate()).padStart(2, "0")}`);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function check() {
    if (!riderReady || !from || !to) return;
    setLoading(true);
    const { data } = await sb
      .from("delivery_records")
      .select("client_id, fee, clients(name)")
      .eq("rider_id", riderId)
      .gte("delivery_date", from)
      .lte("delivery_date", to);
    const map = new Map<string, { client_name: string; count: number; total: number }>();
    for (const r of data ?? []) {
      const cid = r.client_id ?? "_none";
      const cur = map.get(cid) ?? { client_name: r.clients?.name ?? "Tanpa Client", count: 0, total: 0 };
      cur.count++;
      cur.total += Number(r.fee ?? 0);
      map.set(cid, cur);
    }
    setRows(Array.from(map, ([client_id, v]) => ({ client_id, ...v })).sort((a, b) => b.total - a.total));
    setLoading(false);
  }

  const grand = rows?.reduce((s, r) => s + r.total, 0) ?? 0;
  const grandCount = rows?.reduce((s, r) => s + r.count, 0) ?? 0;

  return (
    <div className="mb-4 rounded-lg border border-border bg-card p-3.5">
      <p className="text-xs font-semibold mb-2 flex items-center gap-1.5">
        <Search className="w-3.5 h-3.5" /> Cek Pendapatan
      </p>
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
          className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Lihat"}
        </button>
      </div>
      {rows !== null && (
        <div className="mt-3 border-t border-border pt-2">
          {rows.length === 0 ? (
            <p className="text-xs text-muted-foreground">Tidak ada delivery di periode ini.</p>
          ) : (
            <>
              {rows.map((r) => (
                <div key={r.client_id} className="flex items-center justify-between py-1">
                  <div className="min-w-0">
                    <span className="text-xs truncate">{r.client_name}</span>
                    <span className="text-[10px] text-muted-foreground ml-1.5">{r.count} order</span>
                  </div>
                  <span className="text-xs font-semibold flex-shrink-0">{formatRupiah(r.total)}</span>
                </div>
              ))}
              <div className="flex items-baseline justify-between pt-2 border-t border-border mt-1">
                <span className="text-[10px] text-muted-foreground">{grandCount} order</span>
                <span className="text-sm font-semibold text-primary">{formatRupiah(grand)}</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
