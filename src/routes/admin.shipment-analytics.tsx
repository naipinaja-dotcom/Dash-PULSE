import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AdminLayout } from "@/components/admin-layout";
import { fetchAllRows } from "@/lib/fetch-all";
import { useIntelligenceDate } from "@/lib/use-intelligence-date";
import { useT } from "@/lib/i18n";
import { toast } from "sonner";
import { Package } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

export const Route = createFileRoute("/admin/shipment-analytics")({
  component: ShipmentAnalyticsPage,
});

type ShipmentRow = {
  delivery_date: string;
  status: string | null;
  delivery_type: string | null;
};

function ShipmentAnalyticsPage() {
  const { t } = useT();
  const { from, to } = useIntelligenceDate();
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState<ShipmentRow[] | null>(null);

  // Ga ada filter sendiri di sini — tanggal acuan diatur dari Executive Dashboard.
  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async () => {
    setRunning(true);
    setRows(null);
    try {
      const data = await fetchAllRows<ShipmentRow>((c, f, t) =>
        c
          .from("delivery_records")
          .select("delivery_date, status, delivery_type")
          .gte("delivery_date", from)
          .lte("delivery_date", to)
          .range(f, t),
      );
      // Cuma Completed & Failed yang relevan buat analitik ini — status
      // transien (mis. PENDING_PICKUP) gak lagi masuk dari upload/import baru,
      // tapi baris lama yang udah kepalang ada masih perlu difilter di sini juga.
      setRows(
        data.filter((r) => {
          const s = (r.status ?? "").trim().toUpperCase();
          return s === "COMPLETED" || s === "FAILED";
        }),
      );
      if (data.length === 0) toast.message("Tidak ada data pengiriman di rentang ini.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const total = rows?.length ?? 0;
  const norm = (s: string | null) => (s ?? "").trim().toUpperCase() || "(KOSONG)";
  const byStatus = new Map<string, number>();
  const byType = new Map<string, number>();
  const byDay = new Map<string, number>();
  for (const r of rows ?? []) {
    byStatus.set(norm(r.status), (byStatus.get(norm(r.status)) ?? 0) + 1);
    byType.set(norm(r.delivery_type), (byType.get(norm(r.delivery_type)) ?? 0) + 1);
    byDay.set(r.delivery_date, (byDay.get(r.delivery_date) ?? 0) + 1);
  }
  const completed = byStatus.get("COMPLETED") ?? 0;
  const completionRate = total > 0 ? (completed / total) * 100 : 0;
  const trend = [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, count]) => ({ date: date.slice(5), count }));

  return (
    <AdminLayout
      title={t("shipment.title")}
      subtitle={`${t("shipment.subtitlePre")} ${from} → ${to} (${t("analytics.setPeriod")})`}
    >
      {rows && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <Kpi label={t("shipment.totalShipment")} value={total.toLocaleString("id-ID")} />
            <Kpi label={t("shipment.completed")} value={completed.toLocaleString("id-ID")} accent="success" />
            <Kpi label={t("shipment.completionRate")} value={completionRate.toFixed(1) + "%"} accent="success" />
            <Kpi label={t("shipment.return")} value={(byType.get("RETURN") ?? 0).toLocaleString("id-ID")} />
          </div>

          <div className="rounded-lg border border-border bg-card p-5 mb-4">
            <h3 className="text-sm font-semibold mb-3">{t("shipment.dailyTrend")}</h3>
            {trend.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                {t("analytics.noTrendData")}
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={trend} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                  <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} width={40} />
                  <Tooltip
                    contentStyle={{
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Bar
                    dataKey="count"
                    name="Shipment"
                    fill="var(--primary)"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <BreakdownCard title="Breakdown Status" data={byStatus} total={total} />
            <BreakdownCard title="Breakdown Delivery Type" data={byType} total={total} />
          </div>
        </>
      )}

      {!rows && (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-muted-foreground">
          <Package className="w-8 h-8 mx-auto mb-2 opacity-50" />
          {running ? t("shipment.computing") : t("analytics.loading")}
        </div>
      )}
    </AdminLayout>
  );
}

function BreakdownCard({
  title,
  data,
  total,
}: {
  title: string;
  data: Map<string, number>;
  total: number;
}) {
  const entries = [...data.entries()].sort((a, b) => b[1] - a[1]);
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <h3 className="text-sm font-semibold mb-3">{title}</h3>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("analytics.noData")}</p>
      ) : (
        <div className="space-y-2.5">
          {entries.map(([key, count]) => (
            <div key={key} className="text-sm">
              <div className="flex justify-between mb-1">
                <span className="font-medium">{key}</span>
                <span className="text-muted-foreground">
                  {count.toLocaleString("id-ID")} (
                  {total > 0 ? ((count / total) * 100).toFixed(1) : "0"}%)
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary"
                  style={{ width: Math.max(2, total > 0 ? (count / total) * 100 : 0) + "%" }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: "success" }) {
  return (
    <div
      className={
        "rounded-xl border p-4 " +
        (accent === "success" ? "border-success/30 bg-success/5" : "border-border bg-card")
      }
    >
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={"text-lg font-semibold mt-1 " + (accent === "success" ? "text-success" : "")}>
        {value}
      </div>
    </div>
  );
}
