import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { RiderLayout } from "@/components/rider-layout";
import { supabase } from "@/integrations/supabase/client";
import { useRiderSelf } from "@/lib/use-rider-self";
import { formatRupiah, formatTanggal } from "@/lib/format";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/rider/dashboard")({ component: DashboardPage });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

type DedPeriod = { start: string; end: string; days: number; amount: number };
type DedClient = { clientName: string; days: number; amount: number; periods: DedPeriod[] };
type DedType = { typeName: string; mode: string; totalDays: number; totalAmount: number; clients: DedClient[] };

function DashboardPage() {
  const { rider } = useRiderSelf();
  const { t } = useT();
  const [latest, setLatest] = useState<{ net_pay: number; gross_earning: number; total_deduction: number } | null>(null);
  const [runName, setRunName] = useState<string | null>(null);
  const [installmentTotal, setInstallmentTotal] = useState(0);
  const [dedTypes, setDedTypes] = useState<DedType[]>([]);
  const [dedExpanded, setDedExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!rider) return;
    sb.from("payslips").select("data, payroll_runs(name)").eq("rider_id", rider.id)
      .order("published_at", { ascending: false }).limit(1).maybeSingle()
      .then(({ data }: { data: { data: typeof latest; payroll_runs: { name: string } | null } | null }) => {
        if (data) { setLatest(data.data); setRunName(data.payroll_runs?.name ?? null); }
      });
    supabase.from("rider_installments").select("mode, total_amount, installments_paid, per_period_amount, installment_count")
      .eq("rider_id", rider.id).eq("active", true)
      .then(({ data }) => {
        const remaining = (data ?? [])
          .filter((i) => i.mode === "fixed")
          .reduce((s, i) => s + Math.max(0, ((i.installment_count ?? 0) - i.installments_paid) * (i.per_period_amount ?? 0)), 0);
        setInstallmentTotal(remaining);
      });

    // Rincian potongan terbaru — ambil dari payroll_details terbaru rider ini
    (async () => {
      const { data: details } = await sb.from("payroll_details")
        .select("id, run_id, client_id, payroll_runs(period_start, period_end), clients(name)")
        .eq("rider_id", rider.id)
        .order("created_at", { ascending: false })
        .limit(20);
      if (!details?.length) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const detailIds = details.map((d: any) => d.id);
      const { data: deds } = await sb.from("payroll_deductions")
        .select("detail_id, amount, description, installment_id, deduction_types(name), rider_installments(mode)")
        .in("detail_id", detailIds);
      if (!deds?.length) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const detailMap = new Map(details.map((d: any) => [d.id, d]));
      const byType = new Map<string, { typeName: string; mode: string; totalDays: number; totalAmount: number; byClient: Map<string, DedClient> }>();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const ded of deds as any[]) {
        const detail = detailMap.get(ded.detail_id);
        if (!detail) continue;
        const typeName = ded.deduction_types?.name ?? "Potongan";
        const mode = ded.rider_installments?.mode ?? "auto";
        const amount = Number(ded.amount || 0);
        const dayMatch = ded.description?.match(/Sewa (\d+) hari/);
        const days = dayMatch ? parseInt(dayMatch[1], 10) : 0;
        const clientName = detail.clients?.name ?? "(tanpa client)";
        const pStart = detail.payroll_runs?.period_start ?? "";
        const pEnd = detail.payroll_runs?.period_end ?? "";

        if (!byType.has(typeName)) byType.set(typeName, { typeName, mode, totalDays: 0, totalAmount: 0, byClient: new Map() });
        const t = byType.get(typeName)!;
        t.totalDays += days;
        t.totalAmount += amount;

        const cKey = detail.client_id ?? "_";
        if (!t.byClient.has(cKey)) t.byClient.set(cKey, { clientName, days: 0, amount: 0, periods: [] });
        const c = t.byClient.get(cKey)!;
        c.days += days;
        c.amount += amount;
        c.periods.push({ start: pStart, end: pEnd, days, amount });
      }
      setDedTypes([...byType.values()].map((t) => ({ ...t, clients: [...t.byClient.values()] })).sort((a, b) => b.totalAmount - a.totalAmount));
    })();
  }, [rider]);

  return (
    <RiderLayout title={t("nav.beranda")}>
      <div className="rounded-xl bg-primary text-primary-foreground p-5 mb-4">
        <div className="text-xs opacity-80">{t("rider.latestPayslip")}</div>
        <div className="text-2xl font-semibold mt-1">{formatRupiah(latest?.net_pay ?? 0)}</div>
        <div className="text-[11px] opacity-80 mt-1">
          {latest ? runName ?? "" : t("rider.noPayslip")}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="text-[11px] text-muted-foreground">{t("rider.grossFee")}</div>
          <div className="text-sm font-semibold mt-0.5">{latest ? formatRupiah(latest.gross_earning) : "—"}</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="text-[11px] text-muted-foreground">{t("rider.totalDeduction")}</div>
          <div className="text-sm font-semibold mt-0.5">{latest ? formatRupiah(latest.total_deduction) : "—"}</div>
        </div>
      </div>
      {installmentTotal > 0 && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 mt-3">
          <div className="text-[11px] text-warning">{t("rider.activeInstallment")}</div>
          <div className="text-sm font-semibold mt-0.5 text-warning">{formatRupiah(installmentTotal)}</div>
        </div>
      )}
      {dedTypes.length > 0 && (
        <div className="mt-5">
          <div className="text-sm font-semibold mb-2">{t("rider.recentDeductions")}</div>
          <div className="space-y-2">
            {dedTypes.map((d) => {
              const isOpen = dedExpanded.has(d.typeName);
              return (
                <div key={d.typeName} className="rounded-lg border border-border bg-card overflow-hidden">
                  <button
                    onClick={() => setDedExpanded((prev) => { const n = new Set(prev); n.has(d.typeName) ? n.delete(d.typeName) : n.add(d.typeName); return n; })}
                    className="w-full flex items-center justify-between px-3 py-2.5 text-left"
                  >
                    <div className="flex items-center gap-2">
                      {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
                      <span className="text-[13px] font-medium">{d.typeName}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                        {d.mode === "daily" ? "Harian" : d.mode === "fixed" ? "Cicilan" : "Auto"}
                      </span>
                    </div>
                    <div className="text-[13px] font-semibold tabular-nums">{formatRupiah(d.totalAmount)}</div>
                  </button>
                  {isOpen && (
                    <div className="px-3 pb-3 border-t border-border/50">
                      {d.clients.map((c) => (
                        <div key={c.clientName} className="mt-2">
                          <div className="flex justify-between text-[12px]">
                            <span className="font-medium">{c.clientName}</span>
                            <span className="tabular-nums">
                              {d.mode === "daily" && <span className="text-muted-foreground mr-2">{c.days} hari</span>}
                              {formatRupiah(c.amount)}
                            </span>
                          </div>
                          {c.periods.map((p, i) => (
                            <div key={i} className="flex justify-between text-[11px] text-muted-foreground pl-3 mt-0.5">
                              <span>{formatTanggal(p.start)} — {formatTanggal(p.end)}</span>
                              <span className="tabular-nums">
                                {d.mode === "daily" && <span className="mr-2">{p.days} hari</span>}
                                {formatRupiah(p.amount)}
                              </span>
                            </div>
                          ))}
                        </div>
                      ))}
                      {d.mode === "daily" && d.clients.length > 1 && (
                        <div className="flex justify-between text-[12px] font-medium mt-2 pt-1.5 border-t border-border/30">
                          <span>Total</span>
                          <span className="tabular-nums">{d.totalDays} hari · {formatRupiah(d.totalAmount)}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      <p className="text-[11px] text-muted-foreground mt-6 text-center">
        {t("rider.dataNote")}
      </p>
    </RiderLayout>
  );
}
