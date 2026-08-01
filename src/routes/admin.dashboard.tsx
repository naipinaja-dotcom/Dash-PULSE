import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/admin-layout";
import { formatRupiah } from "@/lib/format";
import {
  Users,
  DollarSign,
  AlertTriangle,
  Truck,
  TrendingUp,
  TrendingDown,
  Calendar,
  Building2,
  Download,
} from "lucide-react";

const isSupabaseConnected = Boolean(import.meta.env.VITE_SUPABASE_URL);

export const Route = createFileRoute("/admin/dashboard")({ component: DashboardPage });

/* ── helpers ────────────────────────────────── */
const fmtNum = (v: number | null) => (v === null ? "…" : v.toLocaleString("id-ID"));
const fmtMoney = (v: number | null, suffix = "jt") =>
  v === null ? "…" : `${(v / 1_000_000).toFixed(1)}${suffix}`;

/* ── types ────────────────────────────────── */
interface TopRider {
  name: string;
  initials: string;
  trips: number;
  fee: number;
}

interface TunggakanItem {
  name: string;
  remaining: number;
  total: number;
  amount: string;
  installments: string;
}

function DashboardPage() {
  const [ridersAktif, setRidersAktif] = useState<number | null>(null);
  const [totalFee, setTotalFee] = useState<number | null>(null);
  const [tunggakanCount, setTunggakanAktif] = useState<number | null>(null);
  const [deliveries, setDeliveries] = useState<number | null>(null);
  const [payrollDraft, setPayrollDraft] = useState<number>(0);
  const [topRiders, setTopRiders] = useState<TopRider[]>([]);
  const [tunggakan, setTunggakan] = useState<TunggakanItem[]>([]);

  useEffect(() => {
    if (!isSupabaseConnected) return;

    supabase
      .from("riders")
      .select("id", { count: "exact", head: true })
      .eq("status", "active")
      .then(({ count }) => setRidersAktif(count ?? 0));

    supabase
      .from("rider_installments")
      .select("id", { count: "exact", head: true })
      .eq("active", true)
      .then(({ count }) => setTunggakanAktif(count ?? 0));

    supabase
      .from("payroll_runs")
      .select("id", { count: "exact", head: true })
      .eq("status", "draft")
      .then(({ count }) => setPayrollDraft(count ?? 0));

    // Top riders by fee (latest payroll period)
    supabase
      .from("payroll_details")
      .select("rider_id, gross_earning, delivery_count, riders(full_name)")
      .order("gross_earning", { ascending: false })
      .limit(5)
      .then(({ data }) => {
        if (data) {
          setTopRiders(
            data.map((r: any) => ({
              name: r.riders?.full_name ?? "Rider",
              initials: (r.riders?.full_name ?? "R")
                .split(" ")
                .map((w: string) => w[0])
                .join("")
                .slice(0, 2)
                .toUpperCase(),
              trips: r.delivery_count ?? 0,
              fee: r.gross_earning ?? 0,
            })),
          );
        }
      });

    // Tunggakan terbesar
    supabase
      .from("rider_installments")
      .select("*, riders(full_name)")
      .eq("active", true)
      .order("remaining_amount", { ascending: false })
      .limit(4)
      .then(({ data }) => {
        if (data) {
          setTunggakan(
            data.map((t: any) => ({
              name: t.riders?.full_name ?? "Rider",
              remaining: t.remaining_installments ?? 0,
              total: t.total_installments ?? 1,
              amount: fmtMoney(t.remaining_amount, "rb"),
              installments: `${t.remaining_installments ?? 0} cicilan`,
            })),
          );
        }
      });
  }, []);

  /* ── stat cards config ────────────────────── */
  const stats = [
    {
      label: "Riders aktif",
      value: fmtNum(ridersAktif),
      icon: Users,
      iconBg: "bg-primary-soft",
      iconColor: "text-primary",
      change: "+3",
      changeUp: true,
    },
    {
      label: "Total fee bulan ini",
      value: totalFee !== null ? fmtMoney(totalFee) : "—",
      icon: DollarSign,
      iconBg: "bg-success/10",
      iconColor: "text-success",
      change: "+6.8%",
      changeUp: true,
    },
    {
      label: "Tunggakan aktif",
      value: fmtNum(tunggakanCount),
      icon: AlertTriangle,
      iconBg: "bg-destructive/10",
      iconColor: "text-destructive",
      change: tunggakanCount !== null && tunggakanCount > 0 ? `${tunggakanCount}` : "0",
      changeUp: false,
    },
    {
      label: "Deliveries minggu ini",
      value: deliveries !== null ? fmtNum(deliveries) : "—",
      icon: Truck,
      iconBg: "bg-warning/10",
      iconColor: "text-warning",
      change: "+12%",
      changeUp: true,
    },
  ];

  /* ── chart data (real weekly from delivery_records) ── */
  type WeekBucket = { label: string; deliveries: number; fee: number };
  const [weeklyData, setWeeklyData] = useState<WeekBucket[]>([]);
  const [hoveredWeek, setHoveredWeek] = useState<number | null>(null);

  useEffect(() => {
    if (!isSupabaseConnected) return;
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const pad = (d: Date) => d.toISOString().slice(0, 10);
    supabase
      .from("delivery_records")
      .select("delivery_date, fee")
      .gte("delivery_date", pad(start))
      .lte("delivery_date", pad(end))
      .then(({ data }) => {
        const weeks = new Map<number, { deliveries: number; fee: number }>();
        for (const r of data ?? []) {
          const day = new Date(r.delivery_date).getDate();
          const w = Math.ceil(day / 7);
          const cur = weeks.get(w) ?? { deliveries: 0, fee: 0 };
          cur.deliveries++;
          cur.fee += Number(r.fee ?? 0);
          weeks.set(w, cur);
        }
        const totalWeeks = Math.ceil(end.getDate() / 7);
        const result: WeekBucket[] = [];
        for (let i = 1; i <= totalWeeks; i++) {
          const d = weeks.get(i) ?? { deliveries: 0, fee: 0 };
          result.push({ label: `W${i}`, ...d });
        }
        setWeeklyData(result);
      });
  }, []);

  const maxDel = useMemo(() => Math.max(...weeklyData.map((w) => w.deliveries), 1), [weeklyData]);
  const maxFee = useMemo(() => Math.max(...weeklyData.map((w) => w.fee), 1), [weeklyData]);

  /* ── alerts ────────────────────────────────── */
  const alerts = [
    {
      type: "danger" as const,
      text: `${payrollDraft || 2} payroll draft belum difinalisasi`,
    },
    { type: "warn" as const, text: "5 rider belum upload attendance" },
    { type: "warn" as const, text: "Disbursement Client A jatuh tempo besok" },
    { type: "info" as const, text: "Ops Insight report baru tersedia" },
  ];

  const alertStyles = {
    danger: "bg-destructive/10 border-destructive/20 before:bg-destructive",
    warn: "bg-warning/10 border-warning/20 before:bg-warning",
    info: "bg-primary-soft border-primary-border/20 before:bg-primary",
  };

  return (
    <AdminLayout title="Dashboard" subtitle="Ringkasan operasional — Juli 2026">
      {/* ── Header actions ─── */}
      <div className="flex items-center justify-between mb-5">
        <div />
        <div className="flex items-center gap-2">
          <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card text-xs text-muted-foreground hover:border-primary-border hover:text-primary transition-colors">
            <Calendar className="w-3 h-3" />7 hari terakhir
          </button>
          <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card text-xs text-muted-foreground hover:border-primary-border hover:text-primary transition-colors">
            <Building2 className="w-3 h-3" />
            Semua client
          </button>
          <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition-opacity">
            <Download className="w-3 h-3" />
            Export
          </button>
        </div>
      </div>

      {/* ── Stat cards ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-5">
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <div
              key={s.label}
              className="group rounded-xl border border-border bg-card p-4 shadow-sm hover:border-primary-border hover:-translate-y-0.5 transition-all cursor-pointer"
            >
              <div className="flex items-start justify-between mb-2">
                <span className="text-[11px] font-medium text-muted-foreground">{s.label}</span>
                <div
                  className={`w-7 h-7 rounded-lg ${s.iconBg} grid place-items-center flex-shrink-0`}
                >
                  <Icon className={`w-3.5 h-3.5 ${s.iconColor}`} />
                </div>
              </div>
              <div
                className="text-2xl font-bold tracking-tight tabular-nums"
                style={{ fontFamily: "'JetBrains Mono', 'Plus Jakarta Sans', monospace" }}
              >
                {s.value}
              </div>
              <div className="flex items-center justify-between mt-1.5">
                <span
                  className={`text-[10px] font-semibold inline-flex items-center gap-0.5 ${s.changeUp ? "text-success" : "text-destructive"}`}
                >
                  {s.changeUp ? (
                    <TrendingUp className="w-3 h-3" />
                  ) : (
                    <TrendingDown className="w-3 h-3" />
                  )}
                  {s.change}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Main content grid ─── */}
      <div className="grid grid-cols-1 xl:grid-cols-[1.3fr_1fr] gap-4 mb-4">
        {/* Chart */}
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[13px] font-semibold">Delivery & fee mingguan</h3>
            <Link to="/admin/shipment-analytics" className="text-[10px] text-primary font-medium hover:underline">
              Lihat detail
            </Link>
          </div>
          {weeklyData.length === 0 ? (
            <div className="h-[170px] flex items-center justify-center text-xs text-muted-foreground">Memuat data...</div>
          ) : (
            <div className="flex items-end gap-3 h-[170px] px-1">
              {weeklyData.map((w, i) => {
                const hDel = (w.deliveries / maxDel) * 130;
                const hFee = (w.fee / maxFee) * 130;
                const active = hoveredWeek === i;
                return (
                  <div key={w.label} className="flex-1 flex flex-col items-center gap-1 relative"
                    onMouseEnter={() => setHoveredWeek(i)} onMouseLeave={() => setHoveredWeek(null)}>
                    {active && (
                      <div className="absolute -top-14 left-1/2 -translate-x-1/2 bg-foreground text-background rounded-lg px-2.5 py-1.5 text-[10px] whitespace-nowrap z-10 shadow-lg">
                        <div className="font-semibold">{w.deliveries} order</div>
                        <div>{formatRupiah(w.fee)}</div>
                        <div className="absolute left-1/2 -translate-x-1/2 -bottom-1 w-2 h-2 bg-foreground rotate-45" />
                      </div>
                    )}
                    <div className="flex gap-1 items-end w-full justify-center">
                      <div className="flex-1 max-w-5 rounded-t-md transition-all duration-300"
                        style={{ height: Math.max(hDel, 4), background: active ? "var(--primary)" : "linear-gradient(to top, hsl(var(--primary)), hsl(var(--primary) / 0.7))", opacity: active ? 1 : 0.85 }} />
                      <div className="flex-1 max-w-5 rounded-t-md transition-all duration-300"
                        style={{ height: Math.max(hFee, 4), background: active ? "hsl(var(--primary) / 0.45)" : "linear-gradient(to top, hsl(var(--primary) / 0.35), hsl(var(--primary) / 0.15))", opacity: active ? 1 : 0.85 }} />
                    </div>
                    <span className={`text-[9px] font-medium transition-colors ${active ? "text-primary" : "text-muted-foreground"}`}
                      style={{ fontFamily: "'JetBrains Mono', monospace" }}>{w.label}</span>
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex gap-4 mt-3">
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <div className="w-2.5 h-2.5 rounded-sm bg-primary" /> Deliveries
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <div className="w-2.5 h-2.5 rounded-sm bg-primary/30" /> Total fee
            </div>
          </div>
        </div>

        {/* Top riders */}
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[13px] font-semibold">Top 5 rider</h3>
            <Link
              to="/admin/riders"
              className="text-[10px] text-primary font-medium hover:underline"
            >
              Lihat semua
            </Link>
          </div>
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider pb-2.5">
                  Rider
                </th>
                <th className="text-right text-[10px] font-semibold text-muted-foreground uppercase tracking-wider pb-2.5">
                  Trip
                </th>
                <th className="text-right text-[10px] font-semibold text-muted-foreground uppercase tracking-wider pb-2.5">
                  Fee
                </th>
              </tr>
            </thead>
            <tbody>
              {(topRiders.length > 0
                ? topRiders
                : [
                    { name: "Andi S.", initials: "AS", trips: 142, fee: 2_100_000 },
                    { name: "Budi R.", initials: "BR", trips: 138, fee: 1_900_000 },
                    { name: "Cahyo P.", initials: "CP", trips: 125, fee: 1_800_000 },
                    { name: "Deni W.", initials: "DW", trips: 119, fee: 1_700_000 },
                    { name: "Eko M.", initials: "EM", trips: 112, fee: 1_600_000 },
                  ]
              ).map((r) => (
                <tr
                  key={r.name}
                  className="border-b border-border last:border-b-0 hover:bg-muted/40 transition-colors cursor-pointer"
                >
                  <td className="py-2.5">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full bg-primary-soft grid place-items-center text-[10px] font-semibold text-primary flex-shrink-0">
                        {r.initials}
                      </div>
                      <span className="font-semibold">{r.name}</span>
                    </div>
                  </td>
                  <td
                    className="text-right text-muted-foreground tabular-nums"
                    style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "11px" }}
                  >
                    {r.trips}
                  </td>
                  <td
                    className="text-right font-semibold text-primary tabular-nums"
                    style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "11px" }}
                  >
                    {(r.fee / 1_000_000).toFixed(1)}jt
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Bottom grid ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Alerts */}
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <h3 className="text-[13px] font-semibold mb-3">Perlu perhatian</h3>
          <div className="space-y-1.5">
            {alerts.map((a, i) => (
              <div
                key={i}
                className={`relative flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[11px] border before:absolute before:left-3 before:w-[7px] before:h-[7px] before:rounded-full ${alertStyles[a.type]}`}
                style={{ paddingLeft: "2rem" }}
              >
                {a.text}
              </div>
            ))}
          </div>
        </div>

        {/* Tunggakan */}
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[13px] font-semibold">Tunggakan terbesar</h3>
            <Link
              to="/admin/deductions"
              className="text-[10px] text-primary font-medium hover:underline"
            >
              Lihat semua
            </Link>
          </div>
          <div className="space-y-0">
            {(tunggakan.length > 0
              ? tunggakan
              : [
                  {
                    name: "Fajar H.",
                    remaining: 3,
                    total: 5,
                    amount: "850rb",
                    installments: "3 cicilan tersisa",
                  },
                  {
                    name: "Gilang A.",
                    remaining: 5,
                    total: 8,
                    amount: "720rb",
                    installments: "5 cicilan tersisa",
                  },
                  {
                    name: "Hadi S.",
                    remaining: 2,
                    total: 4,
                    amount: "650rb",
                    installments: "2 cicilan tersisa",
                  },
                  {
                    name: "Irwan T.",
                    remaining: 4,
                    total: 6,
                    amount: "580rb",
                    installments: "4 cicilan tersisa",
                  },
                ]
            ).map((t) => (
              <div
                key={t.name}
                className="flex items-center justify-between py-2.5 border-b border-border last:border-b-0"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-semibold">{t.name}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{t.installments}</div>
                  <div className="h-[3px] bg-border rounded-full mt-1 w-full">
                    <div
                      className="h-full bg-destructive rounded-full"
                      style={{
                        width: `${(t.remaining / t.total) * 100}%`,
                      }}
                    />
                  </div>
                </div>
                <span
                  className="text-[12px] font-bold text-destructive tabular-nums ml-3 flex-shrink-0"
                  style={{ fontFamily: "'JetBrains Mono', monospace" }}
                >
                  {t.amount}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Supabase warning */}
      {!isSupabaseConnected && (
        <div className="rounded-lg border border-primary-border/30 bg-primary-soft p-4 mt-5">
          <div className="text-sm font-medium text-primary-soft-foreground mb-1">
            Hubungkan Supabase untuk data real
          </div>
          <p className="text-xs text-primary-soft-foreground/80">
            Dashboard menampilkan data dummy. Connect Supabase project untuk menarik data dari tabel{" "}
            <code className="text-[11px]">riders</code>,{" "}
            <code className="text-[11px]">payroll_runs</code>, dan{" "}
            <code className="text-[11px]">rider_installments</code>.
          </p>
        </div>
      )}
    </AdminLayout>
  );
}
