import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PaginationBar } from "@/components/pagination-bar";
import { usePagination } from "@/lib/use-pagination";
import { toCSV, downloadCSV } from "@/lib/csv";
import { toast } from "sonner";
import { Download, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { formatTanggal } from "@/lib/format";
import { useT } from "@/lib/i18n";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;
const rp = (n: number) => "Rp" + Math.round(n).toLocaleString("id-ID");

type PeriodEntry = { start: string; end: string; days: number; amount: number; dates: string[] };

type ClientBreakdown = {
  clientId: string;
  clientName: string;
  days: number;
  amount: number;
  description: string;
  periods: PeriodEntry[];
};

type RiderRecap = {
  riderId: string;
  riderName: string;
  employeeId: string;
  homeClient: string;
  deductions: {
    typeName: string;
    mode: string;
    totalAmount: number;
    totalDays: number;
    clients: ClientBreakdown[];
  }[];
  grandTotal: number;
};

function monthOptions() {
  const opts: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("id-ID", { month: "long", year: "numeric" });
    opts.push({ value: val, label });
  }
  return opts;
}

export function RecapTab() {
  const { t } = useT();
  const months = useMemo(monthOptions, []);
  const [month, setMonth] = useState(months[0].value);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<RiderRecap[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [summaryCards, setSummaryCards] = useState({
    totalDeduction: 0,
    totalRiders: 0,
    totalDailyDays: 0,
    avgPerRider: 0,
  });

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const monthStart = `${month}-01`;
        const meDate = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0);
        const monthEnd = `${meDate.getFullYear()}-${String(meDate.getMonth() + 1).padStart(2, "0")}-${String(meDate.getDate()).padStart(2, "0")}`;

        const { data: runs, error: e1 } = await sb.from("payroll_runs")
          .select("id, client_id, period_start, period_end, clients(name)")
          .gte("period_end", monthStart)
          .lte("period_start", monthEnd);
        if (e1) throw e1;
        if (!runs?.length) { setRows([]); setSummaryCards({ totalDeduction: 0, totalRiders: 0, totalDailyDays: 0, avgPerRider: 0 }); return; }

        const runMap = new Map<string, { clientId: string; clientName: string; start: string; end: string }>();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const r of runs as any[]) {
          runMap.set(r.id, {
            clientId: r.client_id,
            clientName: r.clients?.name ?? "(tanpa client)",
            start: r.period_start,
            end: r.period_end,
          });
        }
        const runIds = [...runMap.keys()];

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let allDetails: any[] = [];
        for (let i = 0; i < runIds.length; i += 200) {
          const { data } = await sb.from("payroll_details")
            .select("id, run_id, rider_id, client_id, riders(full_name, employee_id, client_id)")
            .in("run_id", runIds.slice(i, i + 200));
          allDetails.push(...(data ?? []));
        }

        const detailIds = allDetails.map((d: { id: string }) => d.id);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let allDeds: any[] = [];
        for (let i = 0; i < detailIds.length; i += 200) {
          const { data } = await sb.from("payroll_deductions")
            .select("detail_id, installment_id, amount, description, deduction_types(name), rider_installments(mode)")
            .in("detail_id", detailIds.slice(i, i + 200));
          allDeds.push(...(data ?? []));
        }

        const dedsByDetail = new Map<string, typeof allDeds>();
        for (const d of allDeds) {
          const arr = dedsByDetail.get(d.detail_id) ?? [];
          arr.push(d);
          dedsByDetail.set(d.detail_id, arr);
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const riderAgg = new Map<string, {
          riderId: string;
          riderName: string;
          employeeId: string;
          homeClient: string;
          byType: Map<string, {
            typeName: string;
            mode: string;
            totalAmount: number;
            totalDays: number;
            byClient: Map<string, ClientBreakdown>;
          }>;
          grandTotal: number;
        }>();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const detail of allDetails as any[]) {
          const deds = dedsByDetail.get(detail.id) ?? [];
          if (!deds.length) continue;

          const riderId = detail.rider_id;
          const run = runMap.get(detail.run_id);
          if (!run) continue;

          if (!riderAgg.has(riderId)) {
            const homeClientId = detail.riders?.client_id;
            let homeClientName = "(tanpa client)";
            if (homeClientId) {
              const matchRun = [...runMap.values()].find((r) => r.clientId === homeClientId);
              homeClientName = matchRun?.clientName ?? "(tanpa client)";
            }
            riderAgg.set(riderId, {
              riderId,
              riderName: detail.riders?.full_name ?? "(tanpa nama)",
              employeeId: detail.riders?.employee_id ?? "",
              homeClient: homeClientName,
              byType: new Map(),
              grandTotal: 0,
            });
          }
          const rider = riderAgg.get(riderId)!;

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          for (const ded of deds as any[]) {
            const typeName = ded.deduction_types?.name ?? "Potongan";
            const mode = ded.rider_installments?.mode ?? "auto";
            const amount = Number(ded.amount || 0);

            if (!rider.byType.has(typeName)) {
              rider.byType.set(typeName, {
                typeName,
                mode,
                totalAmount: 0,
                totalDays: 0,
                byClient: new Map(),
              });
            }
            const typeAgg = rider.byType.get(typeName)!;
            typeAgg.totalAmount += amount;

            const dayMatch = ded.description?.match(/Sewa (\d+) hari/);
            const days = dayMatch ? parseInt(dayMatch[1], 10) : 0;
            typeAgg.totalDays += days;

            // Tanggal PERSIS yang kepotong, di-embed di description pas
            // generate (lihat payroll-generate.ts) — fallback ke rentang
            // periode run kalau baris lama sebelum fitur ini ada / gak match.
            const datesMatch = ded.description?.match(/\(tgl ([\d/,\s]+)\)/);
            const dates: string[] = datesMatch
              ? datesMatch[1].split(",").map((s: string) => s.trim())
              : [];

            const cKey = run.clientId ?? "_";
            if (!typeAgg.byClient.has(cKey)) {
              typeAgg.byClient.set(cKey, {
                clientId: run.clientId,
                clientName: run.clientName,
                days: 0,
                amount: 0,
                description: ded.description ?? "",
                periods: [],
              });
            }
            const cAgg = typeAgg.byClient.get(cKey)!;
            cAgg.days += days;
            cAgg.amount += amount;
            cAgg.description = ded.description ?? cAgg.description;
            cAgg.periods.push({ start: run.start, end: run.end, days, amount, dates });

            rider.grandTotal += amount;
          }
        }

        const result: RiderRecap[] = [...riderAgg.values()]
          .map((r) => ({
            ...r,
            deductions: [...r.byType.values()].map((t) => ({
              ...t,
              clients: [...t.byClient.values()],
            })),
          }))
          .sort((a, b) => b.grandTotal - a.grandTotal);

        let totalDailyDays = 0;
        let totalDeduction = 0;
        for (const r of result) {
          totalDeduction += r.grandTotal;
          for (const d of r.deductions) totalDailyDays += d.totalDays;
        }

        setSummaryCards({
          totalDeduction,
          totalRiders: result.length,
          totalDailyDays,
          avgPerRider: result.length ? totalDeduction / result.length : 0,
        });
        setRows(result);
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [month]);

  const toggle = (id: string) => setExpanded((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const { pageSize, setPageSize, page, setPage, totalPages, paged, from, to, total } =
    usePagination(rows, 20);

  const exportCSV = () => {
    const header = ["Kode Mitra", "Nama", "Home Client", "Jenis Potongan", "Mode", "Client", "Hari", "Nominal"];
    const data: (string | number)[][] = [];
    for (const r of rows) {
      for (const d of r.deductions) {
        for (const c of d.clients) {
          data.push([r.employeeId, r.riderName, r.homeClient, d.typeName, d.mode, c.clientName, c.days, c.amount]);
        }
      }
    }
    downloadCSV(`rekap-deduction-${month}.csv`, toCSV([header, ...data]));
  };

  return (
    <>
      <div className="flex flex-wrap items-end gap-3 mb-5">
        <div>
          <label className="text-sm font-medium block mb-1">{t("recap.period")}</label>
          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="rounded-md border-2 border-border-strong bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
          >
            {months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
        <button
          onClick={exportCSV}
          disabled={!rows.length}
          className="inline-flex items-center gap-2 rounded-md border-2 border-border-strong bg-primary text-primary-foreground px-3 py-2 text-sm font-bold shadow-[3px_3px_0_0_var(--color-border-strong)] disabled:opacity-50 disabled:shadow-none hover:brightness-105 active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-[filter,transform,box-shadow]"
        >
          <Download className="w-4 h-4" /> {t("btn.export")}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> {t("btn.loading")}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            <div className="rounded-lg border border-border p-3.5">
              <div className="text-[11.5px] text-muted-foreground font-medium">{t("recap.totalDeduction")}</div>
              <div className="text-xl font-bold mt-1">{rp(summaryCards.totalDeduction)}</div>
            </div>
            <div className="rounded-lg border border-border p-3.5">
              <div className="text-[11.5px] text-muted-foreground font-medium">{t("recap.ridersAffected")}</div>
              <div className="text-xl font-bold mt-1">{summaryCards.totalRiders}</div>
            </div>
            <div className="rounded-lg border border-border p-3.5">
              <div className="text-[11.5px] text-muted-foreground font-medium">{t("recap.totalRentalDays")}</div>
              <div className="text-xl font-bold mt-1">{summaryCards.totalDailyDays} {t("recap.dayUnit")}</div>
            </div>
            <div className="rounded-lg border border-border p-3.5">
              <div className="text-[11.5px] text-muted-foreground font-medium">{t("recap.avgPerRider")}</div>
              <div className="text-xl font-bold mt-1">{rp(summaryCards.avgPerRider)}</div>
            </div>
          </div>

          <div className="rounded-lg border border-border overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead className="bg-muted text-left">
                <tr>
                  <th className="p-2 w-8"></th>
                  <th className="px-3">{t("recap.employeeId")}</th>
                  <th className="px-3">{t("recap.name")}</th>
                  <th className="px-3">{t("recap.deductedAt")}</th>
                  <th className="px-3 text-right">{t("recap.deductionTypes")}</th>
                  <th className="px-3 text-right">{t("recap.totalDays")}</th>
                  <th className="px-3 text-right">{t("recap.totalAmount")}</th>
                </tr>
              </thead>
              <tbody>
                {paged.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-muted-foreground">
                      {t("recap.noData")}
                    </td>
                  </tr>
                ) : paged.map((r) => {
                  const isOpen = expanded.has(r.riderId);
                  const totalDays = r.deductions.reduce((s, d) => s + d.totalDays, 0);
                  return (
                    <React.Fragment key={r.riderId}>
                      <tr
                        className="border-t border-border cursor-pointer hover:bg-muted/50"
                        onClick={() => toggle(r.riderId)}
                      >
                        <td className="p-2 text-muted-foreground">
                          {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </td>
                        <td className="px-3 font-mono text-xs">{r.employeeId}</td>
                        <td className="px-3 font-medium">{r.riderName}</td>
                        <td className="px-3">
                          <div className="flex flex-wrap gap-1">
                            {[...new Set(r.deductions.flatMap((d) => d.clients.map((c) => c.clientName)))].map((name) => (
                              <span key={name} className="inline-block text-[11px] px-2 py-0.5 rounded-full bg-muted font-medium">{name}</span>
                            ))}
                          </div>
                        </td>
                        <td className="px-3 text-right text-muted-foreground">{r.deductions.length} {t("recap.types")}</td>
                        <td className="px-3 text-right tabular-nums">{totalDays > 0 ? `${totalDays} ${t("recap.dayUnit")}` : "—"}</td>
                        <td className="px-3 text-right font-semibold tabular-nums">{rp(r.grandTotal)}</td>
                      </tr>
                      {isOpen && r.deductions.map((d) => (
                        <tr key={`${r.riderId}-${d.typeName}`} className="border-t border-border/30">
                          <td></td>
                          <td colSpan={6} className="px-3 py-2">
                            <div className="ml-2">
                              <div className="flex items-center gap-2 mb-1.5">
                                <span className="font-medium text-[13px]">{d.typeName}</span>
                                <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                                  {d.mode === "daily" ? t("recap.daily") : d.mode === "monthly" ? t("recap.monthly") : d.mode === "fixed" ? t("recap.installment") : t("recap.auto")}
                                </span>
                              </div>
                              <table className="w-full text-[12.5px]">
                                <thead>
                                  <tr className="text-muted-foreground">
                                    <th className="text-left py-1 pr-4 font-medium">{t("recap.client")}</th>
                                    {d.mode === "daily" && <th className="text-right py-1 pr-4 font-medium">{t("recap.days")}</th>}
                                    <th className="text-right py-1 pr-4 font-medium">{t("recap.amount")}</th>
                                    <th className="text-left py-1 font-medium">{t("recap.description")}</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {d.clients.map((c) => {
                                    const desc = d.mode === "daily" && c.days > 0
                                      ? `${c.days} ${t("recap.dayUnit")} x ${rp(Math.round(c.amount / c.days))}`
                                      : c.description;
                                    const periods = c.periods ?? [];
                                    return (
                                      <React.Fragment key={c.clientId}>
                                        <tr className="border-t border-border/20">
                                          <td className="py-1 pr-4">{c.clientName}</td>
                                          {d.mode === "daily" && (
                                            <td className="py-1 pr-4 text-right tabular-nums">{c.days} {t("recap.dayUnit")}</td>
                                          )}
                                          <td className="py-1 pr-4 text-right tabular-nums font-medium">{rp(c.amount)}</td>
                                          <td className="py-1 text-muted-foreground">{desc}</td>
                                        </tr>
                                        {periods.length > 1 && periods.map((p, pi) => (
                                          <tr key={`${c.clientId}-p${pi}`} className="text-muted-foreground">
                                            <td className="py-0.5 pr-4 pl-4 text-[11px]">
                                              {d.mode === "daily" && p.dates.length > 0
                                                ? `${t("recap.dateAbbrev")} ${p.dates.join(", ")}`
                                                : `${formatTanggal(p.start)} — ${formatTanggal(p.end)}`}
                                            </td>
                                            {d.mode === "daily" && (
                                              <td className="py-0.5 pr-4 text-right text-[11px] tabular-nums">{p.days} {t("recap.dayUnit")}</td>
                                            )}
                                            <td className="py-0.5 pr-4 text-right text-[11px] tabular-nums">{rp(p.amount)}</td>
                                            <td></td>
                                          </tr>
                                        ))}
                                        {periods.length === 1 && (
                                          <tr className="text-muted-foreground">
                                            <td colSpan={d.mode === "daily" ? 4 : 3} className="py-0.5 pl-4 text-[11px]">
                                              {d.mode === "daily" && periods[0].dates.length > 0
                                                ? `${t("recap.datesLabel")}: ${periods[0].dates.join(", ")}`
                                                : `${t("recap.periodLabel")}: ${formatTanggal(periods[0].start)} — ${formatTanggal(periods[0].end)}`}
                                            </td>
                                          </tr>
                                        )}
                                      </React.Fragment>
                                    );
                                  })}
                                </tbody>
                                <tfoot className="font-medium border-t border-border/40">
                                  <tr>
                                    <td className="py-1 pr-4">{t("recap.total")}</td>
                                    {d.mode === "daily" && (
                                      <td className="py-1 pr-4 text-right tabular-nums">{d.totalDays} {t("recap.dayUnit")}</td>
                                    )}
                                    <td className="py-1 text-right tabular-nums">{rp(d.totalAmount)}</td>
                                    <td></td>
                                  </tr>
                                </tfoot>
                              </table>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          {rows.length > 0 && (
            <PaginationBar page={page} totalPages={totalPages} setPage={setPage} from={from} to={to} total={total} />
          )}
        </>
      )}
    </>
  );
}
