import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/admin-layout";
import { fetchAllRows } from "@/lib/fetch-all";
import { listPricingSchemes } from "@/lib/pricing-store";
import type { PricingScheme } from "@/lib/pricing-types";
import type { DeliveryRow, AttendanceLogRow } from "@/lib/pricing-calc";
import { computePnl, buildTrend, type ClientPnl, type ClientLite } from "@/lib/pnl-engine";
import { formatRupiah } from "@/lib/format";
import { useIntelligenceDate } from "@/lib/use-intelligence-date";
import { useT } from "@/lib/i18n";
import { toast } from "sonner";
import { Banknote } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

export const Route = createFileRoute("/admin/revenue-analytics")({ component: RevenueAnalyticsPage });

const jt = (n: number) => "Rp " + (n / 1_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 }) + " jt";

function RevenueAnalyticsPage() {
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
  const withoutRevenue = (perClient ?? []).filter((r) => r.revenue === null);
  const totRevenue = withRevenue.reduce((s, r) => s + (r.revenue ?? 0), 0);
  const avgRevenue = withRevenue.length > 0 ? totRevenue / withRevenue.length : 0;
  const topClient = withRevenue.slice().sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0))[0];
  const trend = perClient ? buildTrend(perClient, "daily") : [];
  const ranked = withRevenue.slice().sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0));
  const maxRevenue = Math.max(1, ...ranked.map((r) => r.revenue ?? 0));

  return (
    <AdminLayout title={t("revenue.title")} subtitle={`${t("revenue.subtitlePre")} ${from} → ${to} (${t("analytics.setPeriod")})`}>
      {perClient && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <Kpi label={t("revenue.totalRevenue")} value={jt(totRevenue)} accent="success" />
            <Kpi label={t("revenue.avgPerClient")} value={jt(avgRevenue)} />
            <Kpi label={t("revenue.topClient")} value={topClient ? topClient.client : "—"} />
            <Kpi label={t("revenue.noSchemeClient")} value={String(withoutRevenue.length)} />
          </div>

          <div className="admin-chart-card rounded-xl p-5 mb-4">
            <h3 className="text-sm font-semibold mb-3">{t("revenue.trendTitle")}</h3>
            {trend.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">{t("analytics.noTrendData")}</p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={trend} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                  <defs><linearGradient id="revenueAreaGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-grad-from)" stopOpacity={0.42} /><stop offset="100%" stopColor="var(--chart-grad-from)" stopOpacity={0.04} /></linearGradient></defs>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="bucket" tick={{ fontSize: 11 }} tickLine={false} axisLine={{ stroke: "var(--border)", strokeOpacity: 0.35 }} />
                  <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v) => jt(v)} width={70} />
                  <Tooltip
                    cursor={{ stroke: "var(--primary)", strokeWidth: 1, strokeOpacity: 0.4 }}
                    contentStyle={{ background: "var(--card)", border: "2px solid var(--border-strong)", borderRadius: 6, boxShadow: "4px 4px 0 0 var(--border-strong)", fontSize: 12 }}
                    formatter={(value: number) => formatRupiah(value)}
                  />
                  <Area type="monotone" dataKey="revenue" name="Revenue" stroke="var(--chart-grad-from)" strokeWidth={3} fill="url(#revenueAreaGrad)" dot={{ fill: "var(--chart-grad-from)", stroke: "var(--card)", strokeWidth: 2, r: 4 }} activeDot={{ r: 6, stroke: "var(--border-strong)", strokeWidth: 2 }} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="rounded-lg border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[520px]">
                <thead className="bg-muted text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr><th className="p-3">Client</th><th className="p-3 text-right">Revenue</th><th className="p-3 w-[200px]">Share</th></tr>
                </thead>
                <tbody>
                  {ranked.length === 0 ? (
                    <tr><td colSpan={3} className="p-6 text-center text-muted-foreground">{t("analytics.noRevenueScheme")}</td></tr>
                  ) : ranked.map((r) => (
                    <tr key={r.clientId} className="border-t border-border">
                      <td className="p-3 font-medium">{r.client}</td>
                      <td className="p-3 text-right">{formatRupiah(r.revenue ?? 0)}</td>
                      <td className="p-3">
                        <div className="h-2 rounded-full bg-muted overflow-hidden">
                          <div className="h-full bg-primary" style={{ width: Math.max(2, ((r.revenue ?? 0) / maxRevenue) * 100) + "%" }} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {!perClient && (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-muted-foreground">
          <Banknote className="w-8 h-8 mx-auto mb-2 opacity-50" />
          {running ? t("revenue.computing") : t("analytics.loading")}
        </div>
      )}
    </AdminLayout>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: "success" }) {
  return (
    <div className="admin-kpi-card p-4" data-variant={accent === "success" ? "success" : "default"}>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">{label}</div>
      <div className="admin-metric-value text-[26px] font-bold font-mono tracking-tight">{value}</div>
    </div>
  );
}
