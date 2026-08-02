import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AdminLayout } from "@/components/admin-layout";
import { fetchAllRows } from "@/lib/fetch-all";
import { formatRupiah } from "@/lib/format";
import { useIntelligenceDate } from "@/lib/use-intelligence-date";
import { useT } from "@/lib/i18n";
import { toast } from "sonner";
import { Bike } from "lucide-react";
import { PageSizeSelect, PaginationBar } from "@/components/pagination-bar";
import { usePagination } from "@/lib/use-pagination";

export const Route = createFileRoute("/admin/driver-analytics")({ component: DriverAnalyticsPage });

type DelivRow = { rider_id: string | null; status: string | null; fee: number | null };
type AttRow = { rider_id: string | null; is_late: boolean | null; is_absent: boolean | null; fee: number | null };
type RiderLite = { id: string; full_name: string; employee_id: string };

type DriverLine = {
  riderId: string;
  name: string;
  employeeId: string;
  deliveries: number;
  deliveryFee: number;
  daysWorked: number;
  daysLate: number;
  daysAbsent: number;
  attendanceFee: number;
  totalEarning: number;
  onTimeRate: number; // % dari hari yang benar-benar masuk (bukan absen)
};

const isCompleted = (s: string | null) => String(s ?? "").trim().toLowerCase() === "completed";

function DriverAnalyticsPage() {
  const { t } = useT();
  const { from, to } = useIntelligenceDate();
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState<DriverLine[] | null>(null);
  const [sortBy, setSortBy] = useState<"earning" | "deliveries" | "onTime">("earning");

  // Ga ada filter sendiri di sini — tanggal acuan diatur dari Executive Dashboard.
  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async () => {
    setRunning(true);
    setRows(null);
    try {
      const [delivs, atts, riders] = await Promise.all([
        fetchAllRows<DelivRow>((c, f, t) =>
          c.from("delivery_records").select("rider_id, status, fee")
            .gte("delivery_date", from).lte("delivery_date", to).range(f, t)),
        fetchAllRows<AttRow>((c, f, t) =>
          (c as any).from("attendance_logs").select("rider_id, is_late, is_absent, fee")
            .gte("log_date", from).lte("log_date", to).range(f, t)),
        fetchAllRows<RiderLite>((c, f, t) => c.from("riders").select("id, full_name, employee_id").range(f, t)),
      ]);

      const nameOf = new Map(riders.map((r) => [r.id, r]));
      const byRider = new Map<string, DriverLine>();
      const get = (rid: string): DriverLine => {
        const existing = byRider.get(rid);
        if (existing) return existing;
        const r = nameOf.get(rid);
        const fresh: DriverLine = {
          riderId: rid, name: r?.full_name ?? "(tanpa nama)", employeeId: r?.employee_id ?? "",
          deliveries: 0, deliveryFee: 0, daysWorked: 0, daysLate: 0, daysAbsent: 0,
          attendanceFee: 0, totalEarning: 0, onTimeRate: 0,
        };
        byRider.set(rid, fresh);
        return fresh;
      };

      for (const d of delivs) {
        if (!d.rider_id || !isCompleted(d.status)) continue;
        const line = get(d.rider_id);
        line.deliveries += 1;
        line.deliveryFee += Number(d.fee) || 0;
      }
      for (const a of atts) {
        if (!a.rider_id) continue;
        const line = get(a.rider_id);
        if (a.is_absent) { line.daysAbsent += 1; continue; }
        line.daysWorked += 1;
        if (a.is_late) line.daysLate += 1;
        line.attendanceFee += Number(a.fee) || 0;
      }
      for (const line of byRider.values()) {
        line.totalEarning = line.deliveryFee + line.attendanceFee;
        line.onTimeRate = line.daysWorked > 0 ? ((line.daysWorked - line.daysLate) / line.daysWorked) * 100 : 0;
      }

      const list = [...byRider.values()];
      setRows(list);
      if (list.length === 0) toast.message("Tidak ada data pengiriman/absensi di rentang ini.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const totalDeliveries = (rows ?? []).reduce((s, r) => s + r.deliveries, 0);
  const totalEarning = (rows ?? []).reduce((s, r) => s + r.totalEarning, 0);
  const avgOnTime = rows && rows.length > 0
    ? rows.filter((r) => r.daysWorked > 0).reduce((s, r) => s + r.onTimeRate, 0) / Math.max(1, rows.filter((r) => r.daysWorked > 0).length)
    : 0;

  const sorted = (rows ?? []).slice().sort((a, b) =>
    sortBy === "earning" ? b.totalEarning - a.totalEarning
      : sortBy === "deliveries" ? b.deliveries - a.deliveries
      : b.onTimeRate - a.onTimeRate
  );
  const { pageSize, setPageSize, page, setPage, totalPages, paged, from: pFrom, to: pTo, total: pTotal } = usePagination(sorted, 20);

  return (
    <AdminLayout title={t("driver.title")} subtitle={`${t("driver.subtitlePre")} ${from} → ${to} (${t("analytics.setPeriod")})`}>
      {rows && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <Kpi label={t("driver.activeRiders")} value={String(rows.length)} />
            <Kpi label={t("driver.totalDeliveries")} value={totalDeliveries.toLocaleString("id-ID")} />
            <Kpi label={t("driver.totalEarning")} value={formatRupiah(totalEarning)} accent="success" />
            <Kpi label={t("driver.avgOnTime")} value={avgOnTime.toFixed(1) + "%"} accent={avgOnTime >= 85 ? "success" : "warning"} />
          </div>

          <div className="flex items-center justify-between mb-3">
            <div className="flex gap-1 p-1 bg-muted rounded-md">
              {([["earning", t("driver.earning")], ["deliveries", t("driver.deliveries")], ["onTime", "On-Time %"]] as const).map(([k, l]) => (
                <button key={k} onClick={() => setSortBy(k)}
                  className={`px-3 py-1.5 text-xs rounded ${sortBy === k ? "bg-card shadow-sm font-medium" : "text-muted-foreground"}`}>{l}</button>
              ))}
            </div>
            {sorted.length > 0 && <PageSizeSelect pageSize={pageSize} setPageSize={setPageSize} />}
          </div>

          <div className="rounded-lg border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[720px]">
                <thead className="bg-muted text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="p-3">Rider</th>
                    <th className="p-3 text-right">{t("driver.deliveries")}</th>
                    <th className="p-3 text-right">{t("driver.daysWorked")}</th>
                    <th className="p-3 text-right">Late</th>
                    <th className="p-3 text-right">{t("driver.absent")}</th>
                    <th className="p-3 w-[140px]">On-Time %</th>
                    <th className="p-3 text-right">Total Earning</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.length === 0 ? (
                    <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">{t("analytics.noData")}</td></tr>
                  ) : paged.map((r) => (
                    <tr key={r.riderId} className="border-t border-border">
                      <td className="p-3">
                        <div className="font-medium">{r.name}</div>
                        <div className="text-[11px] text-muted-foreground">{r.employeeId}</div>
                      </td>
                      <td className="p-3 text-right">{r.deliveries}</td>
                      <td className="p-3 text-right">{r.daysWorked}</td>
                      <td className="p-3 text-right text-warning">{r.daysLate}</td>
                      <td className="p-3 text-right text-destructive">{r.daysAbsent}</td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                            <div className={"h-full " + (r.onTimeRate >= 85 ? "bg-success" : r.onTimeRate >= 60 ? "bg-warning" : "bg-destructive")}
                              style={{ width: Math.max(2, r.onTimeRate) + "%" }} />
                          </div>
                          <span className="text-xs">{r.onTimeRate.toFixed(0)}%</span>
                        </div>
                      </td>
                      <td className="p-3 text-right font-medium">{formatRupiah(r.totalEarning)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {sorted.length > 0 && <PaginationBar page={page} totalPages={totalPages} setPage={setPage} from={pFrom} to={pTo} total={pTotal} />}
        </>
      )}

      {!rows && (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-muted-foreground">
          <Bike className="w-8 h-8 mx-auto mb-2 opacity-50" />
          {running ? t("driver.computing") : t("analytics.loading")}
        </div>
      )}
    </AdminLayout>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: "success" | "warning" }) {
  const cls = accent === "success" ? "border-success/30 bg-success/5 text-success" : accent === "warning" ? "border-warning/30 bg-warning/5 text-warning" : "border-border bg-card";
  return (
    <div className={"rounded-xl border p-4 " + cls}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold mt-1">{value}</div>
    </div>
  );
}
