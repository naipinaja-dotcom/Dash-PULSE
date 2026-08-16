import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetch-all";
import { AdminLayout } from "@/components/admin-layout";
import { listPricingSchemes } from "@/lib/pricing-store";
import type { PricingScheme } from "@/lib/pricing-types";
import type { DeliveryRow, AttendanceLogRow } from "@/lib/pricing-calc";
import { computePnl, type ClientPnl } from "@/lib/pnl-engine";
import { fetchMolisRevenueCost } from "@/lib/molis-cost";
import { formatRupiah } from "@/lib/format";
import { useIntelligenceDate } from "@/lib/use-intelligence-date";
import { useT } from "@/lib/i18n";
import { toast } from "sonner";
import { TrendingUp, AlertTriangle, LayoutDashboard } from "lucide-react";

export const Route = createFileRoute("/admin/pnl")({ component: PnlPage });

type ClientLite = { id: string; name: string };
type PnlRow = ClientPnl;

const jt = (n: number) => "Rp " + (n / 1_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 }) + " jt";

function PnlPage() {
  const { t } = useT();
  const [clients, setClients] = useState<ClientLite[]>([]);
  const [schemes, setSchemes] = useState<PricingScheme[]>([]);
  const { from, to } = useIntelligenceDate();
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState<PnlRow[] | null>(null);

  // Ga ada filter sendiri di sini — tanggal acuan diatur dari Executive
  // Dashboard (lihat use-intelligence-date.ts), halaman ini otomatis hitung
  // begitu client/skema selesai dimuat.
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
    if (clients.length > 0 && schemes.length >= 0) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients, schemes]);

  const run = async () => {
    setRunning(true);
    setRows(null);
    try {
      const [all, attAll, molisCost] = await Promise.all([
        fetchAllRows<DeliveryRow & { client_id: string | null }>((c, f, t) =>
          c.from("delivery_records")
            .select("client_id, rider_id, driver_code, delivery_date, district, distance_km, weight_kg, destination_address, service_type, status, delivery_type")
            .gte("delivery_date", from).lte("delivery_date", to).range(f, t)),
        fetchAllRows<AttendanceLogRow & { client_name: string | null }>((c, f, t) =>
          (c as any).from("attendance_logs")
            .select("rider_id, driver_code, client_name, log_date, clock_in, duration_minutes, is_late, is_absent")
            .gte("log_date", from).lte("log_date", to).range(f, t)),
        fetchMolisRevenueCost(from, to),
      ]);
      const { perClient } = computePnl(all, schemes, clients, attAll, molisCost);
      setRows(perClient);
      if (perClient.length === 0) toast.message("Tidak ada data pengiriman di rentang ini.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const totRevenue = (rows ?? []).reduce((s, r) => s + (r.revenue ?? 0), 0);
  const totCost = (rows ?? []).reduce((s, r) => s + r.cost, 0);
  const totMargin = totRevenue - totCost;
  const totPct = totRevenue > 0 ? (totMargin / totRevenue) * 100 : 0;
  const maxMargin = Math.max(1, ...(rows ?? []).map((r) => Math.abs(r.margin ?? 0)));

  return (
    <AdminLayout title={t("margin.title")} subtitle={`${t("margin.subtitlePre")} ${from} → ${to} (${t("analytics.setPeriod")})`}>
      <Link to="/admin/pnl-dashboard" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline mb-4">
        <LayoutDashboard className="w-4 h-4" /> Ubah tanggal di Executive Dashboard
      </Link>

      {rows && (
        <>
          {/* KPI */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <Kpi label="Revenue" value={jt(totRevenue)} />
            <Kpi label="Cost" value={jt(totCost)} />
            <Kpi label="Gross Margin" value={jt(totMargin)} accent="success" />
            <Kpi label="Margin %" value={totPct.toFixed(1) + "%"} accent="success" />
          </div>

          {/* Tabel per client */}
          <div className="rounded-lg border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead className="bg-muted text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="p-3">Client</th>
                    <th className="p-3 text-right">Revenue</th>
                    <th className="p-3 text-right">Cost</th>
                    <th className="p-3 text-right">Margin</th>
                    <th className="p-3 w-[180px]">Margin %</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">Tidak ada data.</td></tr>
                  ) : rows.map((r) => {
                    const loss = r.marginPct !== null && r.marginPct < 0;
                    const thin = r.marginPct !== null && r.marginPct >= 0 && r.marginPct < 15;
                    const noRev = r.revenue === null;
                    const color = loss ? "text-destructive" : thin ? "text-warning" : "text-success";
                    return (
                      <tr key={r.clientId} className={"border-t border-border " + (noRev ? "" : loss ? "bg-destructive/5" : thin ? "bg-warning/5" : "")}>
                        <td className="p-3 font-medium">{r.client}{!noRev && loss ? " 🔴 RUGI" : !noRev && thin ? " ⚠️" : ""}</td>
                        <td className="p-3 text-right">{noRev ? <span className="text-muted-foreground">— belum ada skema client</span> : formatRupiah(r.revenue!)}</td>
                        <td className="p-3 text-right text-muted-foreground">{formatRupiah(r.cost)}</td>
                        <td className={"p-3 text-right font-medium " + (noRev ? "" : color)}>
                          {noRev ? "—" : formatRupiah(r.margin!)}
                        </td>
                        <td className="p-3">
                          {noRev ? "—" : (
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                                <div className={"h-full " + (loss ? "bg-destructive" : thin ? "bg-warning" : "bg-success")}
                                  style={{ width: Math.max(3, Math.min(100, (Math.abs(r.margin ?? 0) / maxMargin) * 100)) + "%" }} />
                              </div>
                              <span className={"text-xs " + color}>
                                {r.marginPct === null ? "—" : `${r.marginPct.toFixed(1)}%`}
                              </span>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {rows.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-border bg-muted font-medium">
                      <td className="p-3">TOTAL</td>
                      <td className="p-3 text-right">{formatRupiah(totRevenue)}</td>
                      <td className="p-3 text-right">{formatRupiah(totCost)}</td>
                      <td className="p-3 text-right text-success">{formatRupiah(totMargin)}</td>
                      <td className="p-3">{totPct.toFixed(1)}%</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          <div className="flex items-start gap-2 mt-3 text-xs text-muted-foreground">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0 text-warning" />
            <span>Baris kuning = margin tipis (0–15%). Baris merah = 🔴 RUGI (cost lebih besar dari revenue). "Belum ada skema client" = revenue-nya belum bisa dihitung karena client itu belum punya skema pricing sisi client. Angka Revenue/Cost dihitung live dari skema + data pengiriman (belum termasuk PPN).</span>
          </div>
        </>
      )}

      {!rows && (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-muted-foreground">
          <TrendingUp className="w-8 h-8 mx-auto mb-2 opacity-50" />
          {running ? "Menghitung margin per client…" : "Memuat…"}
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
