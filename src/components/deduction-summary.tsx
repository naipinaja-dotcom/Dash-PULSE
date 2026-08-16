import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageSizeSelect, PaginationBar } from "@/components/pagination-bar";
import { usePagination } from "@/lib/use-pagination";
import { toCSV, downloadCSV } from "@/lib/csv";
import { ClientCombobox } from "@/components/client-combobox";
import { toast } from "sonner";
import { Download, Loader2 } from "lucide-react";
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";
import type { Run } from "@/components/finance-worksheet";
import { useT } from "@/lib/i18n";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

const rp = (n: number) => "Rp" + Math.round(n).toLocaleString("id-ID");
const COLORS = [
  "#0072B2",
  "#E69F00",
  "#009E73",
  "#CC79A7",
  "#56B4E9",
  "#D55E00",
  "#332288",
  "#999933",
];

type RiderRow = {
  rider_id: string;
  name: string;
  employeeId: string;
  clientId: string | null;
  clientName: string;
  typeAmounts: Record<string, number>;
  installmentTotal: number;
  autoTotal: number;
  total: number;
};
type TypeRollup = {
  name: string;
  installment: number;
  auto: number;
  total: number;
  riderCount: number;
};
type ClientRollup = {
  clientId: string | null;
  clientName: string;
  riderCount: number;
  total: number;
};
type NearlyDone = { riderName: string; typeName: string; paid: number; count: number };

export function DeductionSummary({ runId, run }: { runId: string; run?: Run }) {
  const { t } = useT();
  const [loading, setLoading] = useState(false);
  const [clientId, setClientId] = useState("");
  const [riderRows, setRiderRows] = useState<RiderRow[]>([]);
  const [typeNames, setTypeNames] = useState<string[]>([]);
  const [typeRollups, setTypeRollups] = useState<TypeRollup[]>([]);
  const [clientRollups, setClientRollups] = useState<ClientRollup[]>([]);
  const [paidOffCount, setPaidOffCount] = useState(0);
  const [nearlyDone, setNearlyDone] = useState<NearlyDone[]>([]);

  useEffect(() => {
    if (!runId) return;
    (async () => {
      setLoading(true);
      try {
        // Sama grain/join path kayak ClientReport & FinanceWorksheet — ditarik
        // dari report_summary_weekly (canonical), bukan payroll_details langsung.
        const { data: details, error: e1 } = await sb
          .from("report_summary_weekly")
          .select("id:detail_id, rider_id, client_id, rider_name, rider_employee_id, client_name")
          .eq("run_id", runId);
        if (e1) throw e1;

        const detailIds = (details ?? []).map((d: { id: string }) => d.id);
        const dedRows: {
          detail_id: string;
          installment_id: string | null;
          amount: number;
          deduction_types: { name: string } | null;
        }[] = [];
        for (let i = 0; i < detailIds.length; i += 200) {
          const chunk = detailIds.slice(i, i + 200);
          const { data, error: e2 } = await sb
            .from("payroll_deductions")
            .select("detail_id, installment_id, amount, deduction_types(name)")
            .in("detail_id", chunk);
          if (e2) throw e2;
          dedRows.push(...(data ?? []));
        }

        const riderIds = [
          ...new Set((details ?? []).map((d: { rider_id: string }) => d.rider_id)),
        ] as string[];
        const installmentIds = [
          ...new Set(dedRows.map((d) => d.installment_id).filter(Boolean)),
        ] as string[];
        let paidOff = 0;
        if (installmentIds.length) {
          const { data: insts, error: e3 } = await sb
            .from("rider_installments")
            .select("id, mode, active, installments_paid, installment_count")
            .in("id", installmentIds);
          if (e3) throw e3;
          paidOff = (insts ?? []).filter(
            (i: {
              mode: string;
              active: boolean;
              installments_paid: number;
              installment_count: number | null;
            }) =>
              i.mode === "fixed" &&
              !i.active &&
              i.installment_count != null &&
              i.installments_paid >= i.installment_count,
          ).length;
        }
        setPaidOffCount(paidOff);

        // Cicilan aktif yang paling dekat lunas — dibatasi ke rider di run ini,
        // biar tetap konsisten sebagai "laporan periode ini", bukan global.
        if (riderIds.length) {
          const { data: active, error: e4 } = await sb
            .from("rider_installments")
            .select(
              "installments_paid, installment_count, riders(full_name), deduction_types(name)",
            )
            .eq("mode", "fixed")
            .eq("active", true)
            .not("installment_count", "is", null)
            .in("rider_id", riderIds);
          if (e4) throw e4;
          setNearlyDone(
            (active ?? [])
              .map(
                (a: {
                  installments_paid: number;
                  installment_count: number;
                  riders: { full_name: string } | null;
                  deduction_types: { name: string } | null;
                }) => ({
                  riderName: a.riders?.full_name ?? "(tanpa nama)",
                  typeName: a.deduction_types?.name ?? "Potongan",
                  paid: a.installments_paid,
                  count: a.installment_count,
                }),
              )
              .sort((a: NearlyDone, b: NearlyDone) => b.paid / b.count - a.paid / a.count)
              .slice(0, 5),
          );
        }

        const byDetail = new Map(
          dedRows.reduce((m, d) => {
            (m.get(d.detail_id) ?? m.set(d.detail_id, []).get(d.detail_id)!).push(d);
            return m;
          }, new Map<string, typeof dedRows>()),
        );

        const typeSet = new Set<string>();
        const riders: RiderRow[] = (details ?? [])
          .map(
            (d: {
              id: string;
              rider_id: string;
              client_id: string | null;
              rider_name: string | null;
              rider_employee_id: string | null;
              client_name: string | null;
            }) => {
              const deds = byDetail.get(d.id) ?? [];
              const typeAmounts: Record<string, number> = {};
              let installmentTotal = 0,
                autoTotal = 0;
              for (const ded of deds) {
                const name = ded.deduction_types?.name ?? "Potongan";
                typeSet.add(name);
                typeAmounts[name] = (typeAmounts[name] ?? 0) + Number(ded.amount || 0);
                if (ded.installment_id) installmentTotal += Number(ded.amount || 0);
                else autoTotal += Number(ded.amount || 0);
              }
              return {
                rider_id: d.rider_id,
                name: d.rider_name ?? "(tanpa nama)",
                employeeId: d.rider_employee_id ?? "",
                clientId: d.client_id,
                clientName: d.client_name ?? "(tanpa client)",
                typeAmounts,
                installmentTotal,
                autoTotal,
                total: installmentTotal + autoTotal,
              };
            },
          )
          .filter((r: RiderRow) => r.total > 0);

        const typeMap = new Map<string, TypeRollup>();
        for (const ded of dedRows) {
          const name = ded.deduction_types?.name ?? "Potongan";
          const acc = typeMap.get(name) ?? {
            name,
            installment: 0,
            auto: 0,
            total: 0,
            riderCount: 0,
          };
          const amt = Number(ded.amount || 0);
          if (ded.installment_id) acc.installment += amt;
          else acc.auto += amt;
          acc.total += amt;
          typeMap.set(name, acc);
        }
        for (const [name, acc] of typeMap) {
          acc.riderCount = new Set(
            riders.filter((r) => (r.typeAmounts[name] ?? 0) > 0).map((r) => r.rider_id),
          ).size;
        }

        const clientMap = new Map<string, ClientRollup>();
        for (const r of riders) {
          const key = r.clientId ?? "_";
          const acc = clientMap.get(key) ?? {
            clientId: r.clientId,
            clientName: r.clientName,
            riderCount: 0,
            total: 0,
          };
          acc.riderCount += 1;
          acc.total += r.total;
          clientMap.set(key, acc);
        }

        setTypeNames([...typeSet].sort());
        setRiderRows(riders.sort((a, b) => b.total - a.total));
        setTypeRollups([...typeMap.values()].sort((a, b) => b.total - a.total));
        setClientRollups([...clientMap.values()].sort((a, b) => b.total - a.total));
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [runId]);

  const filteredRiders = useMemo(
    () => (clientId ? riderRows.filter((r) => r.clientId === clientId) : riderRows),
    [riderRows, clientId],
  );
  const clients = useMemo(
    () =>
      clientRollups
        .filter((c) => c.clientId)
        .map((c) => ({ value: c.clientId as string, label: c.clientName })),
    [clientRollups],
  );

  const totals = useMemo(
    () =>
      filteredRiders.reduce(
        (s, r) => ({
          installment: s.installment + r.installmentTotal,
          auto: s.auto + r.autoTotal,
          total: s.total + r.total,
        }),
        { installment: 0, auto: 0, total: 0 },
      ),
    [filteredRiders],
  );

  const { pageSize, setPageSize, page, setPage, totalPages, paged, from, to, total } =
    usePagination(filteredRiders, 20);

  const exportCSV = () => {
    const header = [
      "Kode Mitra",
      "Nama",
      "Client",
      ...typeNames,
      "Cicilan",
      "Auto-Recurring",
      "Total",
    ];
    const data = filteredRiders.map((r) => [
      r.employeeId,
      r.name,
      r.clientName,
      ...typeNames.map((t) => r.typeAmounts[t] ?? 0),
      r.installmentTotal,
      r.autoTotal,
      r.total,
    ]);
    downloadCSV(`ringkasan-potongan-${run?.name ?? runId}.csv`, toCSV([header, ...data]));
  };

  if (loading) return <Loader2 className="w-4 h-4 animate-spin" />;

  return (
    <>
      <div className="rounded-lg border-2 border-border-strong bg-warning text-warning-foreground text-xs px-3.5 py-2.5 mb-4 leading-relaxed">
        {t("dedSummary.cashFlowNote1")}
        <b>{t("dedSummary.cashFlowNoteBukan")}</b>
        {t("dedSummary.cashFlowNote2")}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <div className="rounded-lg border border-border p-3.5">
          <div className="text-[11.5px] text-muted-foreground font-medium">
            {t("dedSummary.totalDeductionPeriod")}
          </div>
          <div className="text-xl font-bold mt-1">{rp(totals.total)}</div>
          <div className="text-[11.5px] text-muted-foreground/70 mt-0.5">
            {filteredRiders.length} {t("dedSummary.riderUnit")}
          </div>
        </div>
        <div className="rounded-lg border border-border p-3.5">
          <div className="text-[11.5px] text-muted-foreground font-medium">
            {t("dedSummary.installmentLabel")}
          </div>
          <div className="text-xl font-bold mt-1">{rp(totals.installment)}</div>
          <div className="text-[11.5px] text-muted-foreground/70 mt-0.5">
            {totals.total ? Math.round((totals.installment / totals.total) * 100) : 0}
            {t("dedSummary.percentOfTotal")}
          </div>
        </div>
        <div className="rounded-lg border border-border p-3.5">
          <div className="text-[11.5px] text-muted-foreground font-medium">
            {t("dedSummary.autoRecurringLabel")}
          </div>
          <div className="text-xl font-bold mt-1">{rp(totals.auto)}</div>
          <div className="text-[11.5px] text-muted-foreground/70 mt-0.5">
            {totals.total ? Math.round((totals.auto / totals.total) * 100) : 0}
            {t("dedSummary.percentOfTotal")}
          </div>
        </div>
        <div className="rounded-lg border border-border p-3.5">
          <div className="text-[11.5px] text-muted-foreground font-medium">
            {t("dedSummary.installmentsClearedThisPeriod")}
          </div>
          <div className="text-xl font-bold mt-1">
            {paidOffCount} {t("dedSummary.riderUnit")}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr] gap-4 mb-5">
        <div>
          <div className="text-[13px] font-bold mb-2">{t("dedSummary.perClientHeading")}</div>
          <table className="w-full text-[13px] border-collapse">
            <thead>
              <tr className="border-b border-border text-muted-foreground text-left">
                <th className="py-1.5 px-2 font-semibold">{t("dedSummary.colClient")}</th>
                <th className="py-1.5 px-2 font-semibold text-right">{t("dedSummary.colRider")}</th>
                <th className="py-1.5 px-2 font-semibold text-right">{t("dedSummary.colTotal")}</th>
              </tr>
            </thead>
            <tbody>
              {clientRollups.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-4 text-center text-muted-foreground">
                    {t("dedSummary.emptyNoDeductions")}
                  </td>
                </tr>
              ) : (
                clientRollups.map((c) => (
                  <tr key={c.clientId ?? "_"} className="border-b border-border/50">
                    <td className="py-1.5 px-2">{c.clientName}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{c.riderCount}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums font-medium">
                      {rp(c.total)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          <div className="text-[13px] font-bold mt-4 mb-2">{t("dedSummary.perTypeHeading")}</div>
          <table className="w-full text-[13px] border-collapse">
            <thead>
              <tr className="border-b border-border text-muted-foreground text-left">
                <th className="py-1.5 px-2 font-semibold">{t("dedSummary.colDeductionType")}</th>
                <th className="py-1.5 px-2 font-semibold">{t("dedSummary.colType")}</th>
                <th className="py-1.5 px-2 font-semibold text-right">
                  {t("dedSummary.colRiderAffected")}
                </th>
                <th className="py-1.5 px-2 font-semibold text-right">{t("dedSummary.colTotal")}</th>
              </tr>
            </thead>
            <tbody>
              {typeRollups.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-muted-foreground">
                    {t("dedSummary.emptyNoDeductions")}
                  </td>
                </tr>
              ) : (
                typeRollups.map((tr) => (
                  <tr key={tr.name} className="border-b border-border/50">
                    <td className="py-1.5 px-2">{tr.name}</td>
                    <td className="py-1.5 px-2 text-muted-foreground">
                      {tr.installment > 0 && tr.auto > 0
                        ? t("dedSummary.typeMixed")
                        : tr.installment > 0
                          ? t("dedSummary.typeInstallment")
                          : t("dedSummary.typeAutoRecurring")}
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{tr.riderCount}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums font-medium">
                      {rp(tr.total)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div>
          <div className="text-[13px] font-bold mb-2">{t("dedSummary.compositionHeading")}</div>
          {typeRollups.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("dedSummary.emptyNoData")}</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={typeRollups}
                  dataKey="total"
                  nameKey="name"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={2}
                >
                  {typeRollups.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => rp(v)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          )}

          <div className="text-[13px] font-bold mt-4 mb-2">{t("dedSummary.nearlyDoneHeading")}</div>
          <div className="rounded-lg border border-border overflow-hidden">
            {nearlyDone.length === 0 ? (
              <div className="px-2.5 py-3 text-[12.5px] text-muted-foreground text-center">
                {t("dedSummary.emptyNoActiveInstallments")}
              </div>
            ) : (
              nearlyDone.map((n, i) => (
                <div
                  key={i}
                  className={`flex justify-between px-2.5 py-2 text-[12.5px] ${i < nearlyDone.length - 1 ? "border-b border-border/50" : ""}`}
                >
                  <span>
                    {n.riderName} — {n.typeName}
                  </span>
                  <span className="text-muted-foreground">
                    {n.paid}/{n.count}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
        <div className="w-full sm:w-auto">
          <label className="text-sm font-medium block mb-1">{t("dedSummary.filterClientLabel")}</label>
          <ClientCombobox
            value={clientId}
            onChange={setClientId}
            placeholder={t("dedSummary.allClientsPlaceholder")}
            className="w-full sm:w-[240px] text-sm py-2"
            options={clients}
          />
        </div>
        <div className="flex items-center gap-3">
          {filteredRiders.length > 0 && (
            <PageSizeSelect pageSize={pageSize} setPageSize={setPageSize} />
          )}
          <button
            onClick={exportCSV}
            disabled={!filteredRiders.length}
            className="inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm disabled:opacity-50"
          >
            <Download className="w-4 h-4" /> {t("dedSummary.exportCsvButton")}
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-border overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead className="bg-muted text-left">
            <tr>
              <th className="p-2">{t("dedSummary.colPartnerCode")}</th>
              <th className="px-3">{t("dedSummary.colName")}</th>
              <th className="px-3">{t("dedSummary.colClient")}</th>
              {typeNames.map((tn) => (
                <th key={tn} className="text-right px-3">
                  {tn}
                </th>
              ))}
              <th className="text-right px-3">{t("dedSummary.colTotal")}</th>
            </tr>
          </thead>
          <tbody>
            {filteredRiders.length === 0 ? (
              <tr>
                <td
                  colSpan={4 + typeNames.length}
                  className="p-6 text-center text-muted-foreground"
                >
                  {t("dedSummary.emptyNoDeductionsFiltered")}
                </td>
              </tr>
            ) : (
              paged.map((r) => (
                <tr key={r.rider_id} className="border-t border-border">
                  <td className="p-2 font-mono text-xs">{r.employeeId}</td>
                  <td className="px-3 font-medium">{r.name}</td>
                  <td className="px-3 text-muted-foreground">{r.clientName}</td>
                  {typeNames.map((tn) => (
                    <td key={tn} className="text-right px-3 tabular-nums">
                      {r.typeAmounts[tn] ? rp(r.typeAmounts[tn]) : "—"}
                    </td>
                  ))}
                  <td className="text-right px-3 font-semibold tabular-nums">{rp(r.total)}</td>
                </tr>
              ))
            )}
          </tbody>
          {filteredRiders.length > 0 && (
            <tfoot className="bg-muted font-semibold">
              <tr>
                <td className="p-2" colSpan={3}>
                  {t("dedSummary.footerTotal")}
                </td>
                {typeNames.map((tn) => (
                  <td key={tn} className="text-right px-3 tabular-nums">
                    {rp(typeRollups.find((r) => r.name === tn)?.total ?? 0)}
                  </td>
                ))}
                <td className="text-right px-3 tabular-nums">{rp(totals.total)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {filteredRiders.length > 0 && (
        <PaginationBar
          page={page}
          totalPages={totalPages}
          setPage={setPage}
          from={from}
          to={to}
          total={total}
        />
      )}

      <div className="text-[11px] text-muted-foreground mt-4 border-t border-border pt-2.5">
        {t("dedSummary.sourceNotePrefix")}
        <code>payroll_deductions</code>
        {t("dedSummary.sourceNoteSeparator")}
        <code>report_summary_weekly</code>
        {t("dedSummary.sourceNoteSeparator")}
        <code>rider_installments</code>
        {t("dedSummary.sourceNoteMiddle")}
        <code>pnl-engine.ts</code>
        {t("dedSummary.sourceNoteSuffix")}
      </div>
    </>
  );
}
