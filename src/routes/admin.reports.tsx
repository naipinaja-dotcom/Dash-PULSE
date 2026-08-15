import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/admin-layout";
import { PageSizeSelect, PaginationBar } from "@/components/pagination-bar";
import { usePagination } from "@/lib/use-pagination";
import { toCSV, downloadCSV } from "@/lib/csv";
import { useT } from "@/lib/i18n";
import { formatTanggal } from "@/lib/format";
import { toast } from "sonner";
import { Check, ChevronDown, Download, Loader2, Search } from "lucide-react";
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
        <PayrollRunPicker runs={visibleRuns} value={runId} onChange={setRunId} />
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

function payrollClientName(name: string) {
  return name
    .replace(/^payroll\s+/i, "")
    .replace(/\s+periode\s+\d{4}-\d{2}-\d{2}\s*[→-].*$/i, "")
    .trim() || name;
}

function PayrollRunPicker({
  runs,
  value,
  onChange,
}: {
  runs: Run[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);
  const selected = runs.find((run) => run.id === value);
  const filteredRuns = runs.filter((run) => {
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return `${payrollClientName(run.name)} ${run.period_start} ${run.period_end}`.toLowerCase().includes(needle);
  });

  useEffect(() => {
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, []);

  return (
    <div ref={pickerRef} className="relative min-w-[280px] flex-1 max-w-xl">
      <label className="inline-flex border-2 border-[#111827] bg-[#FFD45A] px-2 py-1 text-[11px] font-black uppercase tracking-[0.12em] text-[#111827] shadow-[2px_2px_0_#111827]">Payroll Run</label>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="mt-2 flex w-full items-center justify-between gap-3 rounded-none border-2 border-[#111827] bg-[#FFFDF8] px-4 py-2.5 text-left shadow-[3px_3px_0_#111827] transition-all hover:-translate-x-px hover:-translate-y-px hover:bg-[#FFF5D6] hover:shadow-[4px_4px_0_#111827] focus:outline-none focus:ring-2 focus:ring-primary"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-black text-[#111827]">
            {selected ? payrollClientName(selected.name) : "Pilih Payroll Run"}
          </span>
          {selected && (
            <span className="mt-0.5 block text-[11px] text-muted-foreground">
              {formatTanggal(selected.period_start)} – {formatTanggal(selected.period_end)}
            </span>
          )}
        </span>
        {selected && (
          <span className={`shrink-0 border-2 border-[#111827] px-2 py-1 text-[10px] font-black uppercase tracking-wide ${selected.status === "published" ? "bg-[#FFD45A] text-[#513600]" : "bg-[#FFB4A8] text-[#6C2117]"}`}>
            {selected.status === "published" ? "Published" : "Finalized"}
          </span>
        )}
        <ChevronDown className={`h-5 w-5 shrink-0 text-[#111827] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute z-30 mt-3 w-full overflow-hidden rounded-none border-2 border-[#111827] bg-[#FFFDF8] shadow-[4px_4px_0_#111827]">
          <div className="border-b-2 border-[#111827] bg-[#F2E9FF] p-2.5">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => event.key === "Escape" && setOpen(false)}
                placeholder="Cari client atau periode..."
                className="w-full rounded-none border-2 border-[#111827] bg-[#FFFDF8] py-2.5 pl-9 pr-3 text-sm font-semibold text-[#111827] outline-none placeholder:text-[#5B6473] focus:bg-white focus:ring-2 focus:ring-[#7C4DFF]"
              />
            </label>
          </div>
          <div role="listbox" className="max-h-72 overflow-y-auto bg-[#FFFDF8] p-2">
            {filteredRuns.length === 0 ? (
              <p className="px-3 py-5 text-center text-xs text-muted-foreground">Payroll tidak ditemukan.</p>
            ) : (
              filteredRuns.map((run) => (
                <button
                  key={run.id}
                  type="button"
                  role="option"
                  aria-selected={run.id === value}
                  onClick={() => {
                    onChange(run.id);
                    setOpen(false);
                    setQuery("");
                  }}
                  className={`flex w-full items-center gap-3 rounded-none border-2 px-3 py-2.5 text-left transition-all ${run.id === value ? "mb-1.5 border-[#111827] bg-[#E4D4FF] shadow-[2px_2px_0_#111827]" : "border-transparent hover:border-[#111827] hover:bg-[#FFF0B5]"}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-black text-[#111827]">{payrollClientName(run.name)}</span>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">
                      {formatTanggal(run.period_start)} – {formatTanggal(run.period_end)}
                    </span>
                  </span>
                  <span className={`shrink-0 border-2 border-[#111827] px-2 py-1 text-[10px] font-black uppercase tracking-wide ${run.status === "published" ? "bg-[#FFD45A] text-[#513600]" : "bg-[#FFB4A8] text-[#6C2117]"}`}>
                    {run.status === "published" ? "Published" : "Finalized"}
                  </span>
                  {run.id === value && <Check className="h-5 w-5 shrink-0 text-[#5A23D8] stroke-[3]" />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
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
