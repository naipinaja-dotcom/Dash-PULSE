import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/admin-layout";
import { fetchAllRows } from "@/lib/fetch-all";
import { listPricingSchemes } from "@/lib/pricing-store";
import type { PricingScheme } from "@/lib/pricing-types";
import type { DeliveryRow, AttendanceLogRow } from "@/lib/pricing-calc";
import { computePnl, buildTrend, type ClientPnl, type ClientLite } from "@/lib/pnl-engine";
import { useIntelligenceDate } from "@/lib/use-intelligence-date";
import { useT } from "@/lib/i18n";
import { toast } from "sonner";
import { Percent, AlertTriangle } from "lucide-react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from "recharts";

export const Route = createFileRoute("/admin/bcr-analytics")({ component: BcrAnalyticsPage });

// Kategori sama seperti Margin Analytics (admin.pnl.tsx) & Executive Dashboard —
// biar konsisten: rugi <0%, tipis 0-15%, sehat >=15%.
function bucketOf(marginPct: number | null): "rugi" | "tipis" | "sehat" | "no_rev" {
  if (marginPct === null) return "no_rev";
  if (marginPct < 0) return "rugi";
  if (marginPct < 15) return "tipis";
  return "sehat";
}

function BcrAnalyticsPage() {
  const { t } = useT();
  const [clients, setClients] = useState<ClientLite[]>([]);
  const [schemes, setSchemes] = useState<PricingScheme[]>([]);
  const { from, to } = useIntelligenceDate();
  const [running, setRunning] = useState(false);
  const [perClient, setPerClient] = useState<ClientPnl[] | null>(null);

  // Ga ada filter sendiri di sini — tanggal acuan diatur dari Executive
  // Dashboard, halaman ini otomatis hitung begitu client/skema selesai dimuat.
  useEffect(() => {
    (async () => {
      const [{ data: clientsData }, schemesData] = await Promise.all([
        supabase.from("clients").select("id, name").order("name"),
        listPricingSchemes(),
      ]);
      setClients(clientsData ?? []);
      setSchemes(schemesData);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (clients.length > 0) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients, schemes]);

  const run = async () => {
    setRunning(true);
    setPerClient(null);
    try {
      const [data, attData] = await Promise.all([
        fetchAllRows<DeliveryRow & { client_id: string | null }>((c, f, t) =>
          c.from("delivery_records")
            .select("client_id, rider_id, driver_code, delivery_date, district, distance_km, weight_kg, destination_address, service_type, status, delivery_type")
            .gte("delivery_date", from).lte("delivery_date", to).range(f, t)
        ),
        fetchAllRows<AttendanceLogRow & { client_name: string | null }>((c, f, t) =>
          (c as any).from("attendance_logs")
            .select("rider_id, driver_code, client_name, log_date, clock_in, duration_minutes, is_late, is_absent")
            .gte("log_date", from).lte("log_date", to).range(f, t)
        ),
      ]);
      const { perClient: pc } = computePnl(data, schemes, clients, attData);
      setPerClient(pc);
      if (pc.length === 0) toast.message("Tidak ada data pengiriman di rentang ini.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const withRevenue = (perClient ?? []).filter((r) => r.revenue !== null);
  const rugi = withRevenue.filter((r) => bucketOf(r.marginPct) === "rugi");
  const tipis = withRevenue.filter((r) => bucketOf(r.marginPct) === "tipis");
  const sehat = withRevenue.filter((r) => bucketOf(r.marginPct) === "sehat");
  const avgBcr = withRevenue.length > 0 ? withRevenue.reduce((s, r) => s + (r.marginPct ?? 0), 0) / withRevenue.length : 0;
  const trend = perClient ? buildTrend(perClient, "daily") : [];
  // urut dari yang paling parah — biar yang butuh perhatian keliatan duluan
  const ranked = withRevenue.slice().sort((a, b) => (a.marginPct ?? 0) - (b.marginPct ?? 0));

  return (
    <AdminLayout title={t("bcr.title")} subtitle={`${t("bcr.subtitlePre")} ${from} → ${to} (${t("analytics.setPeriod")})`}>
      {perClient && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <Kpi label={t("bcr.avgBcr")} value={avgBcr.toFixed(1) + "%"} accent={avgBcr < 0 ? "destructive" : avgBcr < 15 ? "warning" : "success"} />
            <Kpi label={t("bcr.clientLoss")} value={String(rugi.length)} accent="destructive" />
            <Kpi label={t("bcr.clientThin")} value={String(tipis.length)} accent="warning" />
            <Kpi label={t("bcr.clientHealthy")} value={String(sehat.length)} accent="success" />
          </div>

          <div className="rounded-lg border border-border bg-card p-5 mb-4">
            <h3 className="text-sm font-semibold mb-3">{t("bcr.trendTitle")}</h3>
            {trend.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">{t("analytics.noTrendData")}</p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={trend} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                  <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickFormatter={(v) => v + "%"} width={45} />
                  <ReferenceLine y={0} stroke="var(--destructive)" strokeDasharray="3 3" />
                  <ReferenceLine y={15} stroke="var(--warning)" strokeDasharray="3 3" />
                  <Tooltip
                    contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                    formatter={(value: number) => value.toFixed(1) + "%"}
                  />
                  <Line type="monotone" dataKey="marginPct" name="BCR" stroke="var(--success)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
            <p className="text-[11px] text-muted-foreground mt-2">{t("bcr.legendNote")}</p>
          </div>

          <div className="rounded-lg border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[520px]">
                <thead className="bg-muted text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr><th className="p-3">Client</th><th className="p-3 text-right">Margin</th><th className="p-3 w-[160px]">BCR (Margin %)</th></tr>
                </thead>
                <tbody>
                  {ranked.length === 0 ? (
                    <tr><td colSpan={3} className="p-6 text-center text-muted-foreground">{t("analytics.noRevenueScheme")}</td></tr>
                  ) : ranked.map((r) => {
                    const b = bucketOf(r.marginPct);
                    const color = b === "rugi" ? "text-destructive" : b === "tipis" ? "text-warning" : "text-success";
                    const bar = b === "rugi" ? "bg-destructive" : b === "tipis" ? "bg-warning" : "bg-success";
                    return (
                      <tr key={r.clientId} className={"border-t border-border " + (b === "rugi" ? "bg-destructive/5" : b === "tipis" ? "bg-warning/5" : "")}>
                        <td className="p-3 font-medium">{r.client}{b === "rugi" ? " 🔴" : b === "tipis" ? " ⚠️" : ""}</td>
                        <td className={"p-3 text-right font-medium " + color}>{(r.margin ?? 0).toLocaleString("id-ID")}</td>
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                              <div className={"h-full " + bar} style={{ width: Math.max(2, Math.min(100, Math.abs(r.marginPct ?? 0))) + "%" }} />
                            </div>
                            <span className={"text-xs " + color}>{(r.marginPct ?? 0).toFixed(1)}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <div className="flex items-start gap-2 mt-3 text-xs text-muted-foreground">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0 text-warning" />
            <span>{t("bcr.sortNote")}</span>
          </div>
        </>
      )}

      {!perClient && (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-muted-foreground">
          <Percent className="w-8 h-8 mx-auto mb-2 opacity-50" />
          {running ? t("bcr.computing") : t("analytics.loading")}
        </div>
      )}
    </AdminLayout>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: "success" | "warning" | "destructive" }) {
  const variant = accent === "success" ? "success" : accent === "warning" ? "warning" : accent === "destructive" ? "danger" : "default";
  return (
    <div className="admin-kpi-card p-4" data-variant={variant}>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">{label}</div>
      <div className="admin-metric-value text-[26px] font-bold font-mono tracking-tight">{value}</div>
    </div>
  );
}
