import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { RiderLayout } from "@/components/rider-layout";
import { supabase } from "@/integrations/supabase/client";
import { useRiderSelf } from "@/lib/use-rider-self";
import { formatRupiah, formatTanggal } from "@/lib/format";
import { ChevronDown, ChevronRight, CircleDollarSign, ReceiptText, WalletCards } from "lucide-react";
import { useT } from "@/lib/i18n";
import { fixedRemaining, latestRentalUnpaid } from "@/lib/arrears";

export const Route = createFileRoute("/rider/dashboard")({ component: DashboardPage });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

type DedPeriod = { start: string; end: string; days: number; amount: number };
type DedClient = { clientName: string; days: number; amount: number; periods: DedPeriod[] };
type DedType = {
  typeName: string;
  mode: string;
  totalDays: number;
  totalAmount: number;
  clients: DedClient[];
  // Array, bukan satu nilai — kalau rider punya 2+ installment aktif dengan
  // jenis yang sama, masing-masing punya catatan/tunggakan/progress sendiri
  // dan gak boleh saling nimpa (lihat instInfo di effect di bawah).
  notes: string[];
  tunggakan: number;
  progress: string[];
};

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
    // Dua sumber independen — jalan paralel, baru digabung pas keduanya beres.
    // (1) sisa tunggakan per installment aktif, dipakai buat banner atas +
    // dilampirin ke baris accordion di bawah lewat installment_id.
    // (2) rincian potongan terbaru per jenis, dari payroll_details rider ini.
    // Rumus tunggakannya ada di src/lib/arrears.ts (satu tempat, dipakai juga
    // di admin.dashboard.tsx & ArrearsTab) — sama persis dengan
    // getCarriedArrears() di payroll-generate.ts, di sini cuma dibaca doang.
    const loadArrears = async () => {
      const { data: installments } = await sb.from("rider_installments")
        .select("id, mode, installments_paid, per_period_amount, installment_count, notes")
        .eq("rider_id", rider.id).eq("active", true);
      const rows = installments ?? [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fixedRows = rows.filter((i: any) => i.mode === "fixed");
      const info = new Map<string, { notes: string | null; tunggakan: number; progress: string | null }>();
      let fixedTotal = 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const i of fixedRows as any[]) {
        const { amount } = fixedRemaining(i.installment_count, i.installments_paid, i.per_period_amount);
        info.set(i.id, { notes: i.notes, tunggakan: amount, progress: `${i.installments_paid}/${i.installment_count ?? 0}` });
        fixedTotal += amount;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rentalRows = rows.filter((i: any) => i.mode === "daily" || i.mode === "monthly");
      if (rentalRows.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const latestUnpaid = await latestRentalUnpaid(rentalRows.map((i: any) => i.id));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const i of rentalRows as any[]) {
          info.set(i.id, { notes: i.notes, tunggakan: latestUnpaid.get(i.id) ?? 0, progress: null });
        }
      }
      return { fixedTotal, info };
    };

    const loadDedGroups = async () => {
      const { data: details } = await sb.from("payroll_details")
        .select("id, run_id, client_id, payroll_runs(period_start, period_end), clients(name)")
        .eq("rider_id", rider.id)
        .order("created_at", { ascending: false })
        .limit(20);
      if (!details?.length) return [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const detailIds = details.map((d: any) => d.id);
      const { data: deds } = await sb.from("payroll_deductions")
        .select("detail_id, amount, description, installment_id, deduction_types(name), rider_installments(mode)")
        .in("detail_id", detailIds);
      if (!deds?.length) return [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const detailMap = new Map(details.map((d: any) => [d.id, d]));
      const byType = new Map<
        string,
        { typeName: string; mode: string; totalDays: number; totalAmount: number; byClient: Map<string, DedClient>; installmentIds: Set<string> }
      >();
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

        if (!byType.has(typeName)) byType.set(typeName, { typeName, mode, totalDays: 0, totalAmount: 0, byClient: new Map(), installmentIds: new Set() });
        const g = byType.get(typeName)!;
        g.totalDays += days;
        g.totalAmount += amount;
        if (ded.installment_id) g.installmentIds.add(ded.installment_id);

        const cKey = detail.client_id ?? "_";
        if (!g.byClient.has(cKey)) g.byClient.set(cKey, { clientName, days: 0, amount: 0, periods: [] });
        const c = g.byClient.get(cKey)!;
        c.days += days;
        c.amount += amount;
        c.periods.push({ start: pStart, end: pEnd, days, amount });
      }
      return [...byType.values()];
    };

    (async () => {
      const [{ fixedTotal, info }, groups] = await Promise.all([loadArrears(), loadDedGroups()]);
      setInstallmentTotal(fixedTotal);
      setDedTypes(
        groups
          .map((g) => {
            const notes: string[] = [];
            const progress: string[] = [];
            let tunggakan = 0;
            for (const id of g.installmentIds) {
              const inf = info.get(id);
              if (!inf) continue;
              if (inf.notes) notes.push(inf.notes);
              if (inf.progress) progress.push(inf.progress);
              tunggakan += inf.tunggakan;
            }
            return { ...g, clients: [...g.byClient.values()], notes, tunggakan, progress };
          })
          .sort((a, b) => b.totalAmount - a.totalAmount),
      );
    })();
  }, [rider]);

  return (
    <RiderLayout title={t("nav.beranda")}>
      <div className="rider-enter relative overflow-hidden rounded-[1.75rem] border-2 border-border-strong bg-gradient-to-br from-[#5b21b6] via-primary to-[#312e81] text-primary-foreground p-6 mb-4 shadow-[8px_8px_0_0_var(--color-border-strong)]">
        <div className="absolute -right-10 -top-14 h-44 w-44 rounded-full bg-white/20 blur-2xl" />
        <div className="rider-orb absolute -left-14 -bottom-16 h-40 w-40 rounded-full bg-fuchsia-300/25 blur-2xl" />
        <div className="rider-pulse-line absolute left-0 right-0 bottom-14 h-px opacity-70" />
        <div className="relative"><div className="flex items-center justify-between"><div className="text-[10px] font-semibold tracking-[.16em] uppercase text-primary-foreground/70">{t("rider.latestPayslip")}</div><span className="rounded-full border-2 border-white/40 bg-white/10 px-2.5 py-1 text-[10px] font-semibold">PULSE</span></div>
        <div className="text-3xl font-bold tracking-tight mt-3">{formatRupiah(latest?.net_pay ?? 0)}</div>
        <div className="text-[11px] text-primary-foreground/75 mt-1">{latest ? runName ?? "" : t("rider.noPayslip")}</div>
        <Link to="/rider/payslips" className="mt-5 inline-flex items-center gap-2 rounded-xl border-2 border-white/40 bg-white/10 px-3 py-2 text-[11px] font-bold hover:bg-white/20 active:translate-x-[1px] active:translate-y-[1px] transition-[background-color,transform]">Lihat rincian slip <ChevronRight className="w-3.5 h-3.5" /></Link></div>
      </div>
      <div className="rider-enter rider-enter-delay-1 rounded-2xl border-2 border-border-strong bg-card p-4 shadow-[6px_6px_0_0_var(--color-border-strong)] mb-4">
        <div className="flex items-center justify-between mb-3"><p className="text-[10px] font-semibold tracking-[.14em] text-primary uppercase">Alur penghasilan</p><p className="text-[10px] text-muted-foreground">Periode terbaru</p></div>
        <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-2 text-center"><div><p className="text-[10px] text-muted-foreground">Fee kotor</p><b className="mt-1 block text-xs tabular-nums">{latest ? formatRupiah(latest.gross_earning) : "—"}</b></div><span className="text-primary/60">−</span><div><p className="text-[10px] text-muted-foreground">Potongan</p><b className="mt-1 block text-xs tabular-nums text-warning">{latest ? formatRupiah(latest.total_deduction) : "—"}</b></div><span className="text-primary/60">=</span><div><p className="text-[10px] text-muted-foreground">Bersih</p><b className="mt-1 block text-xs tabular-nums text-primary">{formatRupiah(latest?.net_pay ?? 0)}</b></div></div>
      </div>
      <div className="rider-enter rider-enter-delay-2 grid grid-cols-2 gap-3">
        <div className="rounded-2xl border-2 border-border-strong bg-card p-4 shadow-[5px_5px_0_0_var(--color-border-strong)] transition-transform hover:-translate-y-0.5">
          <CircleDollarSign className="w-4 h-4 text-primary mb-3" /><div className="text-[10px] font-semibold tracking-wider uppercase text-muted-foreground">{t("rider.grossFee")}</div>
          <div className="text-sm font-bold mt-1">{latest ? formatRupiah(latest.gross_earning) : "—"}</div>
        </div>
        <div className="rounded-2xl border-2 border-border-strong bg-card p-4 shadow-[5px_5px_0_0_var(--color-border-strong)] transition-transform hover:-translate-y-0.5">
          <ReceiptText className="w-4 h-4 text-warning mb-3" /><div className="text-[10px] font-semibold tracking-wider uppercase text-muted-foreground">{t("rider.totalDeduction")}</div>
          <div className="text-sm font-bold mt-1">{latest ? formatRupiah(latest.total_deduction) : "—"}</div>
        </div>
      </div>
      {installmentTotal > 0 && (
        <div className="rider-enter rider-enter-delay-3 rounded-2xl border-2 border-border-strong bg-warning/10 p-4 mt-3 shadow-[5px_5px_0_0_var(--color-border-strong)]">
          <div className="text-[11px] text-warning">{t("rider.activeInstallment")}</div>
          <div className="text-sm font-semibold mt-0.5 text-warning">{formatRupiah(installmentTotal)}</div>
        </div>
      )}
      {dedTypes.length > 0 && (
        <div className="mt-5">
          <div className="flex items-center justify-between mb-3"><div className="flex items-center gap-2 text-sm font-semibold"><WalletCards className="w-4 h-4 text-primary" />{t("rider.recentDeductions")}</div><span className="text-[10px] text-muted-foreground">Tap untuk detail</span></div>
          <div className="space-y-2">
            {dedTypes.map((d) => {
              const isOpen = dedExpanded.has(d.typeName);
              return (
                <div key={d.typeName} className="rounded-2xl border-2 border-border-strong bg-card overflow-hidden shadow-[5px_5px_0_0_var(--color-border-strong)] transition-colors hover:border-primary/60">
                  <button
                    onClick={() => setDedExpanded((prev) => { const n = new Set(prev); n.has(d.typeName) ? n.delete(d.typeName) : n.add(d.typeName); return n; })}
                    className="w-full flex items-center justify-between px-4 py-3.5 text-left hover:bg-primary-soft/30 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
                      <span className="text-[13px] font-medium">{d.typeName}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-border-strong bg-muted text-muted-foreground font-medium">
                        {d.mode === "daily" ? t("rider.daily") : d.mode === "fixed" ? t("rider.installment") : t("rider.auto")}
                      </span>
                      {d.tunggakan > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-border-strong bg-warning/15 text-warning font-medium">
                          {t("rider.hasArrears")}
                        </span>
                      )}
                    </div>
                    <div className="text-[13px] font-semibold tabular-nums">{formatRupiah(d.totalAmount)}</div>
                  </button>
                  {isOpen && (
                    <div className="px-3 pb-3 border-t border-border/50">
                      {d.notes.map((note, i) => (
                        <div key={i} className="text-[11px] text-muted-foreground mt-2 leading-relaxed">
                          <span className="font-medium text-foreground/80">{t("rider.adminNote")}:</span> "{note}"
                        </div>
                      ))}
                      {(d.tunggakan > 0 || d.progress.length > 0) && (
                        <div className="flex justify-between items-center gap-3 mt-2 pt-2 border-t border-border/30">
                          {d.tunggakan > 0 && (
                            <div>
                              <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{t("rider.activeInstallment")}</div>
                              <div className="text-[12px] font-semibold text-warning mt-0.5">{formatRupiah(d.tunggakan)}</div>
                            </div>
                          )}
                          {d.progress.length > 0 && (
                            <div className="text-right">
                              <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{t("rider.installment")}</div>
                              <div className="text-[12px] font-medium mt-0.5">{d.progress.join(", ")} {t("rider.installmentUnit")}</div>
                            </div>
                          )}
                        </div>
                      )}
                      {d.clients.map((c) => (
                        <div key={c.clientName} className="mt-2">
                          <div className="flex justify-between text-[12px]">
                            <span className="font-medium">{c.clientName}</span>
                            <span className="tabular-nums">
                              {d.mode === "daily" && <span className="text-muted-foreground mr-2">{c.days} {t("rider.dayUnit")}</span>}
                              {formatRupiah(c.amount)}
                            </span>
                          </div>
                          {c.periods.map((p, i) => (
                            <div key={i} className="flex justify-between text-[11px] text-muted-foreground pl-3 mt-0.5">
                              <span>{formatTanggal(p.start)} — {formatTanggal(p.end)}</span>
                              <span className="tabular-nums">
                                {d.mode === "daily" && <span className="mr-2">{p.days} {t("rider.dayUnit")}</span>}
                                {formatRupiah(p.amount)}
                              </span>
                            </div>
                          ))}
                        </div>
                      ))}
                      {d.mode === "daily" && d.clients.length > 1 && (
                        <div className="flex justify-between text-[12px] font-medium mt-2 pt-1.5 border-t border-border/30">
                          <span>Total</span>
                          <span className="tabular-nums">{d.totalDays} {t("rider.dayUnit")} · {formatRupiah(d.totalAmount)}</span>
                        </div>
                      )}
                      <Link
                        to="/rider/history"
                        className="mt-2.5 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                      >
                        {t("rider.viewPaymentHistory")} <ChevronRight className="w-3 h-3" />
                      </Link>
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
