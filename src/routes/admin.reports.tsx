import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/admin-layout";
import { PageSizeSelect, PaginationBar } from "@/components/pagination-bar";
import { usePagination } from "@/lib/use-pagination";
import { toCSV, downloadCSV } from "@/lib/csv";
import { useT } from "@/lib/i18n";
import { toast } from "sonner";
import { Download, Loader2 } from "lucide-react";
import { FinanceWorksheet } from "@/components/finance-worksheet";
import { DeductionSummary } from "@/components/deduction-summary";

export const Route = createFileRoute("/admin/reports")({ component: ReportsPage });

type Run = {
  id: string;
  name: string;
  period_start: string;
  period_end: string;
  status: string;
  client_id: string | null;
};
type ReportRunStatus = "finalized" | "published";

function ReportsPage() {
  const { t } = useT();
  const [runs, setRuns] = useState<Run[]>([]);
  const [runId, setRunId] = useState("");
  const [runStatus, setRunStatus] = useState<ReportRunStatus>("finalized");
  const [mode, setMode] = useState<"client" | "rider" | "deduction">("rider");

  useEffect(() => {
    // client_id dipakai finance-worksheet.tsx buat nentuin export template
    // mana yang berlaku (lihat src/lib/export-template.ts) — kolom ini belum
    // ada di types.ts generated Supabase (ditambah via migration terpisah,
    // sama pola kayak pricing_schemes), jadi cast `as any` di select-nya.
    (supabase as any)
      .from("payroll_runs")
      .select("id, name, period_start, period_end, status, client_id")
      .order("created_at", { ascending: false })
      .then(({ data }: { data: Run[] | null }) => {
        const reportRuns = (data ?? []).filter(
          (run) => run.status === "finalized" || run.status === "published",
        );
        setRuns(reportRuns);
        const firstFinalized = reportRuns.find((run) => run.status === "finalized");
        const firstPublished = reportRuns.find((run) => run.status === "published");
        if (firstFinalized) {
          setRunStatus("finalized");
          setRunId(firstFinalized.id);
        } else if (firstPublished) {
          setRunStatus("published");
          setRunId(firstPublished.id);
        }
      });
  }, []);

  const visibleRuns = runs.filter((run) => run.status === runStatus);
  const run = visibleRuns.find((r) => r.id === runId);

  const selectRunStatus = (status: ReportRunStatus) => {
    setRunStatus(status);
    setRunId(runs.find((run) => run.status === status)?.id ?? "");
  };

  return (
    <AdminLayout title={t("reports.title")} subtitle={t("reports.subtitle")}>
      <div className="mb-4 rounded-xl border border-border bg-card p-3">
        <div className="flex w-full max-w-md rounded-lg bg-muted p-1">
          <button
            onClick={() => selectRunStatus("finalized")}
            className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${runStatus === "finalized" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            Finalized
            <span className="ml-1.5 text-[11px] opacity-75">{runs.filter((run) => run.status === "finalized").length}</span>
          </button>
          <button
            onClick={() => selectRunStatus("published")}
            className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${runStatus === "published" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            Published
            <span className="ml-1.5 text-[11px] opacity-75">{runs.filter((run) => run.status === "published").length}</span>
          </button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {runStatus === "finalized"
            ? "Payroll sudah terkunci dan siap diproses, tetapi belum menjadi riwayat payslip resmi."
            : "Payroll sudah diterbitkan sebagai payslip resmi dan masuk riwayat."}
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <label className="text-sm font-medium">Payroll Run</label>
          <select
            value={runId}
            onChange={(e) => setRunId(e.target.value)}
            className="mt-1 block min-w-[280px] rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            {visibleRuns.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} ({r.period_start} → {r.period_end}) · {r.status}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-1 p-1 bg-muted rounded-md">
          {(
            [
              ["rider", "Per Rider (Finance)"],
              ["client", "Ringkasan per Client"],
              ["deduction", "Ringkasan Potongan"],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              onClick={() => setMode(k)}
              className={`px-3 py-1.5 text-sm rounded ${mode === k ? "bg-card shadow-sm font-medium" : "text-muted-foreground"}`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
      {!runId ? (
        <p className="text-sm text-muted-foreground">
          {runStatus === "finalized"
            ? "Belum ada payroll yang finalized. Finalize payroll di menu Payroll untuk menampilkannya di sini."
            : "Belum ada payroll yang published. Publish payroll untuk menjadikannya riwayat resmi."}
        </p>
      ) : mode === "rider" ? (
        <FinanceWorksheet runId={runId} run={run} />
      ) : mode === "client" ? (
        <ClientReport runId={runId} run={run} />
      ) : (
        <DeductionSummary runId={runId} run={run} />
      )}
    </AdminLayout>
  );
}

// ============ MODE 2: Ringkasan per Client (lama) ============
type ClientRow = {
  client_id: string | null;
  client_name: string;
  rider_count: number;
  delivery_count: number;
  delivery_fee: number;
  attendance_fee: number;
  incentive: number;
  penalty: number;
  gross: number;
  deduction: number;
  net: number;
};

function ClientReport({ runId, run }: { runId: string; run?: Run }) {
  const [rows, setRows] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!runId) return;
    (async () => {
      setLoading(true);
      // Ditarik dari report_summary_weekly (canonical source), bukan query
      // langsung ke payroll_details — biar angka konsisten sama report lain.
      // Cast `as any`: view ini belum ada di types.ts generated Supabase,
      // sama seperti pola delivery_records/attendance_logs di finance-worksheet.tsx.
      const { data: details, error } = await (supabase as any)
        .from("report_summary_weekly")
        .select("*")
        .eq("run_id", runId);
      if (error) {
        toast.error(error.message);
        setLoading(false);
        return;
      }
      const byClient = new Map<string, ClientRow>();
      for (const d of details ?? []) {
        const cid = d.client_id ?? "_";
        const name = d.client_name ?? "Tanpa Client";
        const acc = byClient.get(cid) ?? {
          client_id: d.client_id,
          client_name: name,
          rider_count: 0,
          delivery_count: 0,
          delivery_fee: 0,
          attendance_fee: 0,
          incentive: 0,
          penalty: 0,
          gross: 0,
          deduction: 0,
          net: 0,
        };
        acc.rider_count += 1;
        acc.delivery_count += d.delivery_count;
        acc.delivery_fee += Number(d.delivery_fee);
        acc.attendance_fee += Number(d.attendance_fee);
        acc.incentive += Number(d.incentive);
        acc.penalty += Number(d.penalty);
        acc.gross += Number(d.gross_earning);
        acc.deduction += Number(d.total_deduction);
        acc.net += Number(d.net_pay);
        byClient.set(cid, acc);
      }
      setRows([...byClient.values()].sort((a, b) => b.net - a.net));
      setLoading(false);
    })();
  }, [runId]);

  const exportCSV = () => {
    const header = [
      "Client",
      "Rider",
      "Delivery Count",
      "Delivery Fee",
      "Attendance Fee",
      "Incentive",
      "Penalty",
      "Gross",
      "Deduction",
      "Net",
    ];
    const data = rows.map((r) => [
      r.client_name,
      r.rider_count,
      r.delivery_count,
      r.delivery_fee,
      r.attendance_fee,
      r.incentive,
      r.penalty,
      r.gross,
      r.deduction,
      r.net,
    ]);
    downloadCSV(`report-${run?.name ?? runId}.csv`, toCSV([header, ...data]));
  };

  const totals = rows.reduce(
    (s, r) => ({
      rider: s.rider + r.rider_count,
      deliv: s.deliv + r.delivery_count,
      gross: s.gross + r.gross,
      ded: s.ded + r.deduction,
      net: s.net + r.net,
    }),
    { rider: 0, deliv: 0, gross: 0, ded: 0, net: 0 },
  );

  const { pageSize, setPageSize, page, setPage, totalPages, paged, from, to, total } =
    usePagination(rows, 20);

  if (loading) return <Loader2 className="w-4 h-4 animate-spin" />;

  return (
    <>
      <div className="flex justify-end items-center gap-3 mb-3">
        {rows.length > 0 && <PageSizeSelect pageSize={pageSize} setPageSize={setPageSize} />}
        <button
          onClick={exportCSV}
          disabled={!rows.length}
          className="inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm disabled:opacity-50"
        >
          <Download className="w-4 h-4" /> Export CSV
        </button>
      </div>
      <div className="rounded-lg border border-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left">
            <tr>
              <th className="p-2">Client</th>
              <th>Rider</th>
              <th>Deliv</th>
              <th>Fee Deliv</th>
              <th>Fee Absensi</th>
              <th>Insentif</th>
              <th>Penalty</th>
              <th>Gross</th>
              <th>Deduction</th>
              <th>Net</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="p-6 text-center text-muted-foreground">
                  Tidak ada data
                </td>
              </tr>
            ) : (
              paged.map((r) => (
                <tr key={r.client_id ?? "_"} className="border-t border-border">
                  <td className="p-2 font-medium">{r.client_name}</td>
                  <td>{r.rider_count}</td>
                  <td>{r.delivery_count}</td>
                  <td>Rp{r.delivery_fee.toLocaleString("id-ID")}</td>
                  <td>Rp{r.attendance_fee.toLocaleString("id-ID")}</td>
                  <td>Rp{r.incentive.toLocaleString("id-ID")}</td>
                  <td className="text-destructive">Rp{r.penalty.toLocaleString("id-ID")}</td>
                  <td>Rp{r.gross.toLocaleString("id-ID")}</td>
                  <td className="text-destructive">Rp{r.deduction.toLocaleString("id-ID")}</td>
                  <td className="font-semibold">Rp{r.net.toLocaleString("id-ID")}</td>
                </tr>
              ))
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="bg-muted font-semibold">
              <tr>
                <td className="p-2">TOTAL</td>
                <td>{totals.rider}</td>
                <td>{totals.deliv}</td>
                <td colSpan={4}></td>
                <td>Rp{totals.gross.toLocaleString("id-ID")}</td>
                <td>Rp{totals.ded.toLocaleString("id-ID")}</td>
                <td>Rp{totals.net.toLocaleString("id-ID")}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {rows.length > 0 && (
        <PaginationBar
          page={page}
          totalPages={totalPages}
          setPage={setPage}
          from={from}
          to={to}
          total={total}
        />
      )}
    </>
  );
}
