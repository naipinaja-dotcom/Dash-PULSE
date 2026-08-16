import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { RiderLayout } from "@/components/rider-layout";
import { supabase } from "@/integrations/supabase/client";
import { useRiderSelf } from "@/lib/use-rider-self";
import { formatRupiah, formatTanggal } from "@/lib/format";
import { ChevronDown, ChevronRight, History, Loader2 } from "lucide-react";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/rider/history")({ component: HistoryPage });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

type PeriodRow = {
  runName: string;
  periodStart: string;
  periodEnd: string;
  clientName: string;
  amount: number;
  paidAmount: number;
};

type InstallmentCard = {
  id: string;
  typeName: string;
  mode: "fixed" | "daily" | "monthly";
  notes: string | null;
  totalAmount: number | null;
  perPeriodAmount: number | null;
  installmentsPaid: number;
  installmentCount: number | null;
  periods: PeriodRow[];
};

function HistoryPage() {
  const { rider } = useRiderSelf();
  const { t } = useT();
  const [cards, setCards] = useState<InstallmentCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!rider) return;
    (async () => {
      setLoading(true);
      const { data: installments } = await sb.from("rider_installments")
        .select("id, mode, notes, total_amount, per_period_amount, installment_count, installments_paid, deduction_types(name)")
        .eq("rider_id", rider.id)
        .eq("charge_target", "rider")
        .order("created_at", { ascending: false });
      const rows = installments ?? [];
      if (rows.length === 0) {
        setCards([]);
        setLoading(false);
        return;
      }

      const { data: deds } = await sb.from("payroll_deductions")
        .select("installment_id, amount, paid_amount, payroll_details(client_id, clients(name), payroll_runs(name, period_start, period_end))")
        .in("installment_id", rows.map((r: any) => r.id))
        .not("paid_amount", "is", null);

      const byInstallment = new Map<string, PeriodRow[]>();
      for (const d of deds ?? []) {
        const detail = d.payroll_details;
        const run = detail?.payroll_runs;
        if (!run || !d.installment_id) continue;
        const list = byInstallment.get(d.installment_id) ?? [];
        list.push({
          runName: run.name,
          periodStart: run.period_start,
          periodEnd: run.period_end,
          clientName: detail.clients?.name ?? "—",
          amount: Number(d.amount || 0),
          paidAmount: Number(d.paid_amount || 0),
        });
        byInstallment.set(d.installment_id, list);
      }

      setCards(
        rows.map((r: any) => ({
          id: r.id,
          typeName: r.deduction_types?.name ?? "Potongan",
          mode: r.mode,
          notes: r.notes,
          totalAmount: r.total_amount == null ? null : Number(r.total_amount),
          perPeriodAmount: r.per_period_amount == null ? null : Number(r.per_period_amount),
          installmentsPaid: r.installments_paid,
          installmentCount: r.installment_count,
          periods: (byInstallment.get(r.id) ?? []).sort((a, b) => b.periodEnd.localeCompare(a.periodEnd)),
        })).filter((c: InstallmentCard) => c.periods.length > 0),
      );
      setLoading(false);
    })();
  }, [rider]);

  return (
    <RiderLayout title={t("history.title")}>
      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : cards.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-border-strong bg-primary-soft/35 p-8 text-center">
          <History className="w-6 h-6 mx-auto mb-2 text-primary/60" />
          <div className="text-sm font-medium">{t("history.empty")}</div>
        </div>
      ) : (
        <div className="space-y-3">
          {cards.map((c) => {
            const isOpen = expanded.has(c.id);
            const modeLabel = c.mode === "daily" ? t("rider.daily") : c.mode === "fixed" ? t("rider.installment") : t("rider.auto");
            const totalDebt = c.totalAmount ?? (c.perPeriodAmount ?? 0) * (c.installmentCount ?? 0);
            const paidTotal = Math.min(totalDebt, c.periods.reduce((sum, period) => sum + period.paidAmount, 0));
            const remainingDebt = Math.max(0, totalDebt - paidTotal);
            const hasOutstandingDebt = c.mode === "fixed" && remainingDebt > 0.5;
            return (
              <div key={c.id} className="rounded-2xl border-2 border-border-strong bg-card overflow-hidden shadow-[5px_5px_0_0_var(--color-border-strong)]">
                <button
                  onClick={() => setExpanded((prev) => { const n = new Set(prev); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; })}
                  className="w-full flex items-center justify-between px-4 py-3.5 text-left hover:bg-primary-soft/30 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />}
                    <span className="text-[13px] font-medium truncate">{c.typeName}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-border-strong bg-muted text-muted-foreground font-medium flex-shrink-0">{modeLabel}</span>
                  </div>
                  {c.mode === "fixed" && (
                    <span className={`text-[11px] font-semibold flex-shrink-0 ml-2 ${hasOutstandingDebt ? "text-warning" : "text-success"}`}>
                      {hasOutstandingDebt ? "Masih ada sisa" : "Sudah selesai"}
                    </span>
                  )}
                </button>
                {c.mode === "fixed" && (
                  <div className={`mx-3 mb-3 rounded-xl border-2 border-border-strong p-3 ${hasOutstandingDebt ? "bg-warning/10" : "bg-success/10"}`}>
                    <div className={`text-[11px] font-bold ${hasOutstandingDebt ? "text-warning" : "text-success"}`}>
                      {hasOutstandingDebt ? "Masih ada tunggakan" : "Tunggakan sudah selesai"}
                    </div>
                    <div className="mt-1 flex items-end justify-between gap-3">
                      <div>
                        <div className="text-[10px] text-muted-foreground">Total tunggakan awal</div>
                        <div className="text-[15px] font-bold tabular-nums">{formatRupiah(totalDebt)}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] text-muted-foreground">Sisa yang harus dibayar</div>
                        <div className={`text-[16px] font-bold tabular-nums ${hasOutstandingDebt ? "text-warning" : "text-success"}`}>{formatRupiah(remainingDebt)}</div>
                      </div>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 border-t border-border/50 pt-2 text-[10px] text-muted-foreground">
                      <span>Sudah dibayar <b className="text-foreground tabular-nums">{formatRupiah(paidTotal)}</b></span>
                      <span className="text-right">Sudah bayar <b className="text-foreground">{c.installmentsPaid} dari {c.installmentCount ?? 0} kali</b></span>
                    </div>
                  </div>
                )}
                {isOpen && (
                  <div className="px-3 pb-3 border-t border-border/50">
                    {c.notes && (
                      <div className="text-[11px] text-muted-foreground mt-2 leading-relaxed">
                        <span className="font-medium text-foreground/80">{t("rider.adminNote")}:</span> "{c.notes}"
                      </div>
                    )}
                    <div className="space-y-1.5 mt-2">
                      {c.periods.map((p, i) => {
                        const unpaid = Math.max(0, p.amount - p.paidAmount);
                        return (
                          <div key={i} className="rounded-xl bg-muted/40 px-3 py-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[12px] font-medium truncate">{p.runName}</span>
                              {unpaid <= 0.5 ? (
                                <span className="text-[11px] font-medium text-success flex-shrink-0">Potongan berhasil</span>
                              ) : (
                                <span className="text-[11px] font-medium text-warning flex-shrink-0">Sisa {formatRupiah(unpaid)}</span>
                              )}
                            </div>
                            <div className="text-[10px] text-muted-foreground mt-0.5">
                              Potongan gaji {formatTanggal(p.periodStart)} — {formatTanggal(p.periodEnd)} · {p.clientName}
                            </div>
                            <div className="flex justify-between text-[11px] mt-1 tabular-nums">
                              <span className="text-muted-foreground">Dipotong dari gaji {formatRupiah(p.amount)}</span>
                              <span className="text-muted-foreground">Sudah dibayar {formatRupiah(p.paidAmount)}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </RiderLayout>
  );
}
