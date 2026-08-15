import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetch-all";
import { AdminLayout } from "@/components/admin-layout";
import { listPricingSchemes } from "@/lib/pricing-store";
import type { PricingScheme } from "@/lib/pricing-types";
import type { DeliveryRow, AttendanceLogRow } from "@/lib/pricing-calc";
import { computePnl, buildTrend, type ClientPnl, type TrendGranularity } from "@/lib/pnl-engine";
import { fetchMolisRevenueCost } from "@/lib/molis-cost";
import { formatRupiah } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { useIntelligenceDate } from "@/lib/use-intelligence-date";
import { triggerWeeklyPnlPushManual } from "@/lib/api/pnl-push.functions";
import { toast } from "sonner";
import { confirmDialog } from "@/components/confirm-dialog";
import { Loader2, TrendingUp, ArrowRight, AlertTriangle, Send, CheckCircle2, XCircle, DollarSign, TrendingDown, Percent, Activity, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, Line, LineChart, ReferenceLine } from "recharts";

function autoGranularity(from: string, to: string): TrendGranularity {
  const days = Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000) + 1;
  if (days > 60) return "monthly";
  if (days > 14) return "weekly";
  return "daily";
}

export const Route = createFileRoute("/admin/pnl-dashboard")({ component: ExecutiveDashboard });

type ClientLite = { id: string; name: string };

const jt = (n: number) => "Rp " + (n / 1_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 }) + " jt";

type PnlSnapshot = {
  id: string;
  week_start: string;
  week_end: string;
  total_revenue: number;
  total_cost: number;
  total_margin: number;
  total_margin_pct: number;
  push_status: { slack?: { ok: boolean; error?: string }; email?: { ok: boolean; error?: string } };
  triggered_by: string;
  created_at: string;
};

function ExecutiveDashboard() {
  const { session } = useAuth();
  const { t } = useT();
  const [clients, setClients] = useState<ClientLite[]>([]);
  const [schemes, setSchemes] = useState<PricingScheme[]>([]);
  const { from, setFrom, to, setTo, resetToDefault } = useIntelligenceDate();
  const [running, setRunning] = useState(false);
  const [perClient, setPerClient] = useState<ClientPnl[] | null>(null);
  const [snapshots, setSnapshots] = useState<PnlSnapshot[]>([]);
  const [pushing, setPushing] = useState(false);
  const [showPnlHistory, setShowPnlHistory] = useState(true);
  const [missingExtra, setMissingExtra] = useState<Record<string, { payrollRuns: number; actualFee: number }>>({});
  const [deletingSnapshotId, setDeletingSnapshotId] = useState<string | null>(null);

  const loadSnapshots = () => {
    (supabase as any)
      .from("pnl_weekly_snapshots")
      .select("id, week_start, week_end, total_revenue, total_cost, total_margin, total_margin_pct, push_status, triggered_by, created_at")
      .order("week_start", { ascending: false })
      .limit(10)
      .then(({ data }: { data: PnlSnapshot[] | null }) => setSnapshots(data ?? []));
  };

  const [initialized, setInitialized] = useState(false);
  useEffect(() => {
    (async () => {
      const [{ data: clientsData }, schemesData] = await Promise.all([
        supabase.from("clients").select("id, name").order("name"),
        listPricingSchemes(),
      ]);
      setClients(clientsData ?? []);
      setSchemes(schemesData);
      setInitialized(true);
    })();
    loadSnapshots();
  }, []);

  useEffect(() => {
    if (initialized) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialized]);

  useEffect(() => {
    if (initialized) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  const testWeeklyPush = async () => {
    if (!session?.access_token) return toast.error("Sesi admin habis — login ulang");
    setPushing(true);
    try {
      const result = await triggerWeeklyPnlPushManual({ data: { adminToken: session.access_token } });
      const slackOk = result.pushStatus.slack.ok;
      const emailOk = result.pushStatus.email.ok;
      if (slackOk && emailOk) toast.success("Weekly PNL berhasil dikirim ke Slack & Email");
      else toast.warning(`Slack: ${slackOk ? "OK" : "gagal — " + result.pushStatus.slack.error}. Email: ${emailOk ? "OK" : "gagal — " + result.pushStatus.email.error}`);
      loadSnapshots();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPushing(false);
    }
  };

  const deleteSnapshot = async (s: PnlSnapshot) => {
    if (!(await confirmDialog({
      title: "Hapus riwayat push ini?",
      description: `Periode ${s.week_start} → ${s.week_end} akan dihapus dari riwayat. Ini cuma catatan pengiriman, tidak membatalkan Slack/Email yang sudah terkirim.`,
      confirmText: "Hapus", danger: true,
    }))) return;
    setDeletingSnapshotId(s.id);
    const { error } = await (supabase as any).from("pnl_weekly_snapshots").delete().eq("id", s.id);
    setDeletingSnapshotId(null);
    if (error) return toast.error(error.message);
    toast.success("Riwayat dihapus");
    loadSnapshots();
  };

  const clearAllSnapshots = async () => {
    if (!(await confirmDialog({
      title: "Hapus semua riwayat push?",
      description: `Semua ${snapshots.length} baris riwayat Weekly PNL Push akan dihapus. Ini cuma catatan pengiriman, tidak membatalkan Slack/Email yang sudah terkirim.`,
      confirmText: "Hapus Semua", danger: true,
    }))) return;
    const { error } = await (supabase as any).from("pnl_weekly_snapshots").delete().not("id", "is", null);
    if (error) return toast.error(error.message);
    toast.success("Semua riwayat dihapus");
    loadSnapshots();
  };

  const run = async () => {
    if (from > to) return toast.error("Tanggal 'dari' tidak boleh setelah 'sampai'");
    setRunning(true);
    setPerClient(null);
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
      const { perClient: pc } = computePnl(all, schemes, clients, attAll, molisCost);
      setPerClient(pc);
      if (pc.length === 0) toast.message("Tidak ada data pengiriman di rentang ini.");

      const missing = pc.filter((r) => r.revenue === null);
      if (missing.length > 0) {
        const ids = missing.map((r) => r.clientId);
        const [{ data: prData }, { data: feeData }] = await Promise.all([
          (supabase as any).from("payroll_runs").select("client_id").in("client_id", ids),
          supabase.from("delivery_records").select("client_id, fee").in("client_id", ids).gte("delivery_date", from).lte("delivery_date", to),
        ]);
        const extra: Record<string, { payrollRuns: number; actualFee: number }> = {};
        for (const id of ids) {
          extra[id] = {
            payrollRuns: (prData ?? []).filter((r: any) => r.client_id === id).length,
            actualFee: (feeData ?? []).filter((r: any) => r.client_id === id).reduce((s: number, r: any) => s + (Number(r.fee) || 0), 0),
          };
        }
        setMissingExtra(extra);
      } else {
        setMissingExtra({});
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRunning(false);
    }
  };


  const totRevenue = (perClient ?? []).reduce((s, r) => s + (r.revenue ?? 0), 0);
  const totCost = (perClient ?? []).reduce((s, r) => s + r.cost, 0);
  const totMargin = totRevenue - totCost;
  const totPct = totRevenue > 0 ? (totMargin / totRevenue) * 100 : 0;
  const clientsWithRevenue = (perClient ?? []).filter((r) => r.revenue !== null);
  const rugiCount = clientsWithRevenue.filter((r) => (r.marginPct ?? 0) < 0).length;
  const thinCount = clientsWithRevenue.filter((r) => (r.marginPct ?? 100) >= 0 && (r.marginPct ?? 100) < 15).length;
  const trend = perClient ? buildTrend(perClient, autoGranularity(from, to)) : [];
  const topByMargin = clientsWithRevenue.slice().sort((a, b) => (b.margin ?? 0) - (a.margin ?? 0)).slice(0, 5);
  const missingRevenue = (perClient ?? []).filter((r) => r.revenue === null);
  const maxTopMargin = Math.max(1, ...topByMargin.map((r) => Math.abs(r.margin ?? 0)));

  return (
    <AdminLayout title={t("exec.title")} subtitle={t("exec.subtitle")}>

      {/* ── Date range control ── */}
      <div className="rounded-xl bg-card border-[3px] border-border-strong shadow-[6px_6px_0_0_var(--color-border-strong)] p-4 mb-5 flex flex-wrap items-end gap-3 text-sm">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Dari</label>
          <input
            type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition-shadow cursor-pointer"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Sampai</label>
          <input
            type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition-shadow cursor-pointer"
          />
        </div>
        <button
          type="button" onClick={resetToDefault}
          className="rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
        >
          7 Hari Terakhir
        </button>
        <div className="flex items-center gap-2 ml-auto">
          {running ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground animate-pulse">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Menghitung…
            </span>
          ) : (
            <span className="text-[11px] text-muted-foreground">Rentang tanggal ini dipakai di semua halaman PnL.</span>
          )}
        </div>
      </div>

      {/* ── KPI cards ── */}
      {perClient && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <Kpi label="Total Revenue" value={jt(totRevenue)} icon={<DollarSign className="w-4 h-4" />} variant="primary" />
          <Kpi label="Total Cost" value={jt(totCost)} icon={<TrendingDown className="w-4 h-4" />} variant="muted" />
          <Kpi label="Gross Margin" value={jt(totMargin)} icon={<Activity className="w-4 h-4" />} variant={totMargin >= 0 ? "success" : "danger"} />
          <Kpi label="Margin %" value={totPct.toFixed(1) + "%"} icon={<Percent className="w-4 h-4" />} variant={totPct >= 15 ? "success" : totPct >= 0 ? "warning" : "danger"} />
        </div>
      )}

      {/* ── Warning banner ── */}
      {perClient && (rugiCount > 0 || thinCount > 0) && (
        <div className="flex items-start gap-3 mb-5 rounded-xl border-[3px] border-border-strong bg-warning text-warning-foreground shadow-[6px_6px_0_0_var(--color-border-strong)] p-4">
          <div className="flex-shrink-0 w-8 h-8 rounded-lg border-2 border-border-strong flex items-center justify-center">
            <AlertTriangle className="w-4 h-4" />
          </div>
          <div className="text-sm">
            <p className="font-bold mb-0.5">Perhatian Margin Client</p>
            <p className="opacity-90">
              {rugiCount > 0 && <span className="font-bold">{rugiCount} client RUGI</span>}
              {rugiCount > 0 && thinCount > 0 && <span> · </span>}
              {thinCount > 0 && <span className="font-bold">{thinCount} client margin tipis (&lt;15%)</span>}
              {" — "}
              <Link to="/admin/pnl" className="font-semibold underline underline-offset-2">
                Lihat rincian di Margin Analytics
              </Link>
            </p>
          </div>
        </div>
      )}

      {/* ── Charts ── */}
      {perClient && (
        <div className="grid md:grid-cols-2 gap-4 mb-5">
          <div className="admin-chart-card rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold">Tren Revenue vs Cost</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Perbandingan pendapatan dan biaya rider</p>
              </div>
            </div>
            {trend.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-muted-foreground gap-2">
                <Activity className="w-7 h-7 opacity-30" />
                <p className="text-sm">Tidak ada data untuk periode ini.</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={trend} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gRev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.18} />
                      <stop offset="95%" stopColor="var(--primary)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gCost" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--muted-foreground)" stopOpacity={0.12} />
                      <stop offset="95%" stopColor="var(--muted-foreground)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.6} />
                  <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickFormatter={(v) => jt(v)} width={68} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ background: "var(--card)", border: "2px solid var(--border-strong)", borderRadius: 8, fontSize: 12, fontWeight: 700, boxShadow: "4px 4px 0 0 var(--border-strong)" }}
                    formatter={(value: number) => formatRupiah(value)}
                  />
                  <Area type="monotone" dataKey="revenue" name="Revenue" stroke="var(--primary)" fill="url(#gRev)" strokeWidth={2} />
                  <Area type="monotone" dataKey="cost" name="Cost" stroke="var(--muted-foreground)" fill="url(#gCost)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="admin-chart-card rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold">Tren BCR (Margin %)</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2 h-0.5 bg-destructive inline-block rounded" /> Rugi
                  </span>
                  {" · "}
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2 h-0.5 bg-amber-500 inline-block rounded" /> &lt;15% tipis
                  </span>
                </p>
              </div>
            </div>
            {trend.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-muted-foreground gap-2">
                <Percent className="w-7 h-7 opacity-30" />
                <p className="text-sm">Tidak ada data untuk periode ini.</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={trend} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.6} />
                  <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickFormatter={(v) => v + "%"} width={40} axisLine={false} tickLine={false} />
                  <ReferenceLine y={0} stroke="var(--destructive)" strokeDasharray="4 3" strokeWidth={1.5} />
                  <ReferenceLine y={15} stroke="var(--warning)" strokeDasharray="4 3" strokeWidth={1.5} />
                  <Tooltip
                    contentStyle={{ background: "var(--card)", border: "2px solid var(--border-strong)", borderRadius: 8, fontSize: 12, fontWeight: 700, boxShadow: "4px 4px 0 0 var(--border-strong)" }}
                    formatter={(value: number) => value.toFixed(1) + "%"}
                  />
                  <Line type="monotone" dataKey="marginPct" name="BCR (Margin %)" stroke="var(--success)" strokeWidth={2.5} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      )}

      {/* ── Bottom panels ── */}
      {perClient && (
        <>
          <div className="grid md:grid-cols-2 gap-4 mb-5">
            <div className="rounded-xl border border-border bg-card shadow-sm p-5">
              <h3 className="text-sm font-semibold mb-4">Top 5 Client berdasarkan Margin</h3>
              {topByMargin.length === 0 ? (
                <p className="text-sm text-muted-foreground">Belum ada client dengan skema revenue.</p>
              ) : (
                <div className="space-y-3">
                  {topByMargin.map((r, i) => {
                    const loss = (r.marginPct ?? 0) < 0;
                    const pct = Math.max(3, Math.min(100, (Math.abs(r.margin ?? 0) / maxTopMargin) * 100));
                    return (
                      <div key={r.clientId}>
                        <div className="flex justify-between items-center mb-1.5 text-sm">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="w-5 h-5 rounded-md bg-muted flex items-center justify-center text-[10px] font-bold text-muted-foreground flex-shrink-0">{i + 1}</span>
                            <span className="font-medium truncate">{r.client}</span>
                          </div>
                          <span className={"font-mono text-xs font-semibold flex-shrink-0 ml-2 " + (loss ? "text-destructive" : "text-success")}>
                            {formatRupiah(r.margin ?? 0)}
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className={"h-full rounded-full transition-[width,opacity] duration-500 " + (loss ? "bg-destructive" : "bg-success")}
                            style={{ width: pct + "%" }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-border bg-card shadow-sm p-5">
              <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-warning" />
                Client Tanpa Skema Revenue
              </h3>
              {missingRevenue.length === 0 ? (
                <div className="flex items-center gap-2 text-sm text-success">
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                  <span>Semua client sudah punya skema revenue (client-side).</span>
                </div>
              ) : (
                <div className="space-y-3">
                  {missingRevenue.map((r) => {
                    const ex = missingExtra[r.clientId];
                    return (
                      <div key={r.clientId} className="rounded-lg border border-border/50 p-3 space-y-1.5">
                        <div className="flex justify-between items-center">
                          <span className="font-medium text-sm">{r.client}</span>
                          {ex && ex.payrollRuns > 0 && (
                            <span className="text-[10px] font-semibold border-2 border-border-strong bg-destructive text-destructive-foreground px-1.5 py-0.5 rounded">PAYROLL RUN ADA</span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span>{r.deliveryCount} pengiriman</span>
                          {r.earliestDelivery && <span>sejak {r.earliestDelivery}</span>}
                          {ex && ex.actualFee > 0 && (
                            <span className="text-foreground font-medium">Fee tercatat: {formatRupiah(ex.actualFee)}</span>
                          )}
                          {ex && ex.actualFee === 0 && r.deliveryCount > 0 && (
                            <span className="text-destructive">Fee: Rp0 (risiko payroll kosong)</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <Link to="/admin/pnl" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline underline-offset-2 transition-colors">
            Lihat rincian per client di Margin Analytics <ArrowRight className="w-4 h-4" />
          </Link>
        </>
      )}

      {/* ── Weekly PNL Push ── */}
      <div className="rounded-xl border border-border bg-card shadow-sm p-5 mt-5">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="text-sm font-semibold">Weekly PNL Push</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">Dikirim otomatis tiap Senin 07:00 WIB ke Slack &amp; Email (butuh pg_cron aktif).</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={testWeeklyPush} disabled={pushing}
              className="inline-flex items-center gap-2 rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors cursor-pointer"
            >
              {pushing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              {pushing ? "Mengirim…" : "Test Kirim Sekarang"}
            </button>
            {snapshots.length > 0 && showPnlHistory && (
              <button onClick={clearAllSnapshots} title="Hapus semua riwayat"
                className="inline-flex items-center gap-1.5 rounded-lg border-2 border-border-strong text-destructive px-2.5 py-2 text-xs hover:bg-destructive hover:text-destructive-foreground transition-colors">
                <Trash2 className="w-3.5 h-3.5" /> Hapus Semua
              </button>
            )}
            <button onClick={() => setShowPnlHistory((v) => !v)} title={showPnlHistory ? "Sembunyikan riwayat" : "Tampilkan riwayat"}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-2 text-xs text-muted-foreground hover:bg-muted transition-colors">
              {showPnlHistory ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
        {!showPnlHistory ? null : snapshots.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Belum ada histori push.</p>
        ) : (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-2 py-2">Periode</th>
                  <th className="text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-2 py-2">Margin</th>
                  <th className="text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-2 py-2">Slack</th>
                  <th className="text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-2 py-2">Email</th>
                  <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-2 py-2">Trigger</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {snapshots.map((s) => (
                  <tr key={s.id} className="border-b border-border/50 last:border-0 hover:bg-muted/40 transition-colors">
                    <td className="px-2 py-2.5 font-mono text-xs">{s.week_start} → {s.week_end}</td>
                    <td className="px-2 py-2.5 text-right font-mono text-xs font-semibold">
                      <span className={s.total_margin >= 0 ? "text-success" : "text-destructive"}>
                        {formatRupiah(s.total_margin)}
                      </span>
                      <span className="text-muted-foreground ml-1">({s.total_margin_pct.toFixed(1)}%)</span>
                    </td>
                    <td className="px-2 py-2.5 text-center">
                      {s.push_status?.slack?.ok
                        ? <CheckCircle2 className="w-4 h-4 text-success mx-auto" />
                        : <span title={s.push_status?.slack?.error}><XCircle className="w-4 h-4 text-destructive mx-auto" /></span>}
                    </td>
                    <td className="px-2 py-2.5 text-center">
                      {s.push_status?.email?.ok
                        ? <CheckCircle2 className="w-4 h-4 text-success mx-auto" />
                        : <span title={s.push_status?.email?.error}><XCircle className="w-4 h-4 text-destructive mx-auto" /></span>}
                    </td>
                    <td className="px-2 py-2.5">
                      <span className="inline-block text-[10px] font-medium uppercase tracking-wider bg-muted text-muted-foreground rounded px-1.5 py-0.5 capitalize">
                        {s.triggered_by}
                      </span>
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      <button onClick={() => deleteSnapshot(s)} disabled={deletingSnapshotId === s.id} title="Hapus baris ini"
                        className="text-muted-foreground hover:text-destructive disabled:opacity-50">
                        {deletingSnapshotId === s.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Empty state ── */}
      {!perClient && !running && (
        <div className="rounded-xl border border-dashed border-border p-14 text-center text-muted-foreground mt-5">
          <div className="w-12 h-12 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-3">
            <TrendingUp className="w-6 h-6 opacity-50" />
          </div>
          <p className="text-sm font-medium">Belum ada data</p>
          <p className="text-xs mt-1 opacity-60">Pilih rentang tanggal untuk lihat ringkasan bisnis.</p>
        </div>
      )}
    </AdminLayout>
  );
}

type KpiVariant = "default" | "primary" | "muted" | "success" | "warning" | "danger";

function Kpi({ label, value, icon, variant = "default" }: { label: string; value: string; icon?: React.ReactNode; variant?: KpiVariant }) {
  return (
    <div className="admin-kpi-card p-4" data-variant={variant}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
        {icon && <div className="stat-icon-chip w-7 h-7 rounded-lg flex items-center justify-center">{icon}</div>}
      </div>
      <div className="admin-metric-value text-[26px] font-bold font-mono tracking-tight">{value}</div>
    </div>
  );
}
