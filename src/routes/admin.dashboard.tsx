import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/admin-layout";
import { formatRupiah } from "@/lib/format";
import { fetchAllRows } from "@/lib/fetch-all";
import { fixedRemaining, latestRentalUnpaid } from "@/lib/arrears";
import {
  Users,
  DollarSign,
  AlertTriangle,
  Truck,
  TrendingUp,
  TrendingDown,
  Calendar,
  Building2,
} from "lucide-react";
import { useT } from "@/lib/i18n";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

const isSupabaseConnected = Boolean(import.meta.env.VITE_SUPABASE_URL);

export const Route = createFileRoute("/admin/dashboard")({ component: DashboardPage });

/* ── helpers ────────────────────────────────── */
const fmtNum = (v: number | null) => (v === null ? "…" : v.toLocaleString("id-ID"));
const fmtMoney = (v: number | null, suffix = "jt") =>
  v === null ? "…" : `${(v / 1_000_000).toFixed(1)}${suffix}`;
const fmtRb = (v: number) => `${Math.round(v / 1000).toLocaleString("id-ID")}rb`;
const dateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

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
  const { t } = useT();
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

    // Tunggakan terbesar — rider_installments gak punya kolom remaining_amount/
    // remaining_installments/total_installments (cuma installment_count,
    // installments_paid, per_period_amount), jadi dihitung manual di sini lewat
    // helper di src/lib/arrears.ts (dipakai juga di ArrearsTab & rider.dashboard,
    // biar satu tempat aja yang jadi sumber kebenaran rumus tunggakan).
    (async () => {
      const { data: installments } = await supabase
        .from("rider_installments")
        .select("id, mode, installment_count, installments_paid, per_period_amount, riders(full_name)")
        .eq("active", true);
      if (!installments) return;

      const fixedItems = installments
        .filter((r: any) => r.mode === "fixed")
        .map((r: any) => {
          const { remaining, total, amount } = fixedRemaining(r.installment_count, r.installments_paid, r.per_period_amount);
          return {
            name: r.riders?.full_name ?? "Rider",
            remaining,
            total,
            amountValue: amount,
            installments: `${remaining} ${t("dash.installmentsLeft")}`,
          };
        })
        .filter((r) => r.remaining > 0);

      const rentalRows = installments.filter((r: any) => r.mode === "daily" || r.mode === "monthly");
      let rentalItems: typeof fixedItems = [];
      if (rentalRows.length > 0) {
        const latestUnpaid = await latestRentalUnpaid(rentalRows.map((r: any) => r.id));
        rentalItems = rentalRows
          .map((r: any) => ({
            name: r.riders?.full_name ?? "Rider",
            remaining: 1,
            total: 1,
            amountValue: latestUnpaid.get(r.id) ?? 0,
            installments: "Tunggakan sewa",
          }))
          .filter((r) => r.amountValue > 0);
      }

      setTunggakan(
        [...fixedItems, ...rentalItems]
          .sort((a, b) => b.amountValue - a.amountValue)
          .slice(0, 4)
          .map((r) => ({ name: r.name, remaining: r.remaining, total: r.total, installments: r.installments, amount: fmtRb(r.amountValue) })),
      );
    })();
  }, []);

  /* ── stat cards config ────────────────────── */
  const stats = [
    {
      label: t("dash.ridersActive"),
      value: fmtNum(ridersAktif),
      icon: Users,
      tone: "neutral" as const,
      change: null,
      changeUp: false,
    },
    {
      label: t("dash.totalFee"),
      value: totalFee !== null ? fmtMoney(totalFee) : "—",
      icon: DollarSign,
      tone: "primary" as const,
      change: null,
      changeUp: false,
    },
    {
      label: t("dash.tunggakanActive"),
      value: fmtNum(tunggakanCount),
      icon: AlertTriangle,
      tone: "destructive" as const,
      change: null,
      changeUp: false,
    },
    {
      label: t("dash.deliveriesWeek"),
      value: deliveries !== null ? fmtNum(deliveries) : "—",
      icon: Truck,
      tone: "success" as const,
      change: null,
      changeUp: false,
    },
  ];

  /* ── KPI + chart data (completed delivery_records only) ── */
  type WeekBucket = { label: string; deliveries: number; fee: number };
  const [weeklyData, setWeeklyData] = useState<WeekBucket[]>([]);

  useEffect(() => {
    if (!isSupabaseConnected) return;

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const weekStart = new Date(now);
    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7)); // Monday
    const from = dateKey(weekStart < monthStart ? weekStart : monthStart);
    const today = dateKey(now);
    const monthStartKey = dateKey(monthStart);
    const weekStartKey = dateKey(weekStart);
    let active = true;

    fetchAllRows<{ id: string; delivery_date: string; fee: number | null }>(
      (client, fromRow, toRow) =>
        client
          .from("delivery_records")
          .select("id, delivery_date, fee")
          .ilike("status", "completed")
          .gte("delivery_date", from)
          .lte("delivery_date", today)
          .range(fromRow, toRow),
    )
      .then((rows) => {
        if (!active) return;
        const monthRows = rows.filter((row) => row.delivery_date >= monthStartKey);
        const weekRows = rows.filter((row) => row.delivery_date >= weekStartKey);
        setTotalFee(monthRows.reduce((sum, row) => sum + Number(row.fee ?? 0), 0));
        setDeliveries(weekRows.length);

        const weeks = new Map<number, { deliveries: number; fee: number }>();
        for (const r of monthRows) {
          const day = new Date(r.delivery_date).getDate();
          const w = Math.ceil(day / 7);
          const cur = weeks.get(w) ?? { deliveries: 0, fee: 0 };
          cur.deliveries++;
          cur.fee += Number(r.fee ?? 0);
          weeks.set(w, cur);
        }
        const totalWeeks = Math.ceil(now.getDate() / 7);
        const result: WeekBucket[] = [];
        for (let i = 1; i <= totalWeeks; i++) {
          const d = weeks.get(i) ?? { deliveries: 0, fee: 0 };
          result.push({ label: `W${i}`, ...d });
        }
        setWeeklyData(result);
      })
      .catch(() => {
        if (!active) return;
        setTotalFee(null);
        setDeliveries(null);
        setWeeklyData([]);
      });

    return () => {
      active = false;
    };
  }, []);

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
    danger: "border-2 border-border-strong bg-destructive text-destructive-foreground",
    warn: "border-2 border-border-strong bg-warning text-warning-foreground",
    info: "border-2 border-border-strong bg-primary text-primary-foreground",
  };

  return (
    <AdminLayout title={t("dash.title")} subtitle={`${t("dash.subtitle")} — ${new Date().toLocaleDateString("id-ID", { month: "long", year: "numeric" })}`}>
      {/* ── Header actions ─── */}
      <div className="flex items-center justify-between mb-5">
        <div />
        <div className="flex items-center gap-2">
          <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card text-[13px] font-medium text-muted-foreground hover:border-primary-border hover:text-primary transition-colors">
            <Calendar className="w-3 h-3" />{t("dash.last7days")}
          </button>
          <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card text-[13px] font-medium text-muted-foreground hover:border-primary-border hover:text-primary transition-colors">
            <Building2 className="w-3 h-3" />
            {t("dash.allClients")}
          </button>
        </div>
      </div>

      {/* ── Stat cards ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-5">
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="admin-stat-card group p-4 cursor-pointer" data-tone={s.tone}>
              <div className="flex items-start justify-between mb-2">
                <span data-eyebrow>{s.label}</span>
                <div className="stat-icon-chip w-7 h-7 rounded-lg grid place-items-center flex-shrink-0">
                  <Icon className="w-3.5 h-3.5" />
                </div>
              </div>
              <div className="admin-metric-value text-[26px] font-bold tracking-tight tabular-nums font-mono">
                {s.value}
              </div>
              {s.change && (
                <div className="flex items-center justify-between mt-1.5">
                  <span
                    className={`text-[11px] font-semibold inline-flex items-center gap-0.5 ${s.changeUp ? "text-success" : "text-destructive"}`}
                  >
                    {s.changeUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                    {s.change}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Main content grid ─── */}
      <div className="grid grid-cols-1 xl:grid-cols-[1.3fr_1fr] gap-4 mb-4">
        {/* Chart */}
        <div className="admin-chart-card rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold">{t("dash.weeklyChart")}</h3>
            <Link to="/admin/shipment-analytics" className="text-xs text-primary font-semibold hover:underline">
              {t("btn.viewDetail")}
            </Link>
          </div>
          {weeklyData.length === 0 ? (
            <div className="h-[240px] flex items-center justify-center text-xs text-muted-foreground">{t("btn.loading")}</div>
          ) : (
            <>
              {/* Order & fee dipisah: satuannya beda (buah vs rupiah), jadi gak
                  boleh ditumpuk di satu sumbu — tinggi batangnya bakal keliatan
                  bisa dibandingin padahal skalanya sendiri-sendiri. */}
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={weeklyData} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="dashBarGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--chart-grad-from)" />
                      <stop offset="100%" stopColor="var(--chart-grad-to)" />
                    </linearGradient>
                  </defs>
                  {/* Warna & opacity garis grid diatur di .admin-chart-card (styles.css). */}
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={{ stroke: "var(--border)", strokeOpacity: 0.35 }} />
                  <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={38} allowDecimals={false} />
                  <Tooltip
                    cursor={{ fill: "var(--color-primary)", opacity: 0.08 }}
                    contentStyle={{
                      background: "var(--card)",
                      border: "2px solid var(--border-strong)",
                      borderRadius: 6,
                      boxShadow: "4px 4px 0 0 var(--border-strong)",
                      fontSize: 12,
                    }}
                    formatter={(value: number) => [value.toLocaleString("id-ID"), "Order"]}
                  />
                  <Bar
                    dataKey="deliveries"
                    fill="url(#dashBarGrad)"
                    stroke="var(--border-strong)"
                    strokeWidth={2}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={56}
                  />
                </BarChart>
              </ResponsiveContainer>
            </>
          )}
        </div>

        {/* Top riders */}
        <div className="rounded-xl border-[3px] border-border-strong bg-card p-5 shadow-[6px_6px_0_0_var(--color-border-strong)]">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold">{t("dash.top5")}</h3>
            <Link
              to="/admin/riders"
              className="text-xs text-primary font-semibold hover:underline"
            >
              {t("btn.viewAll")}
            </Link>
          </div>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider pb-2.5">
                  Rider
                </th>
                <th className="text-right text-[11px] font-semibold text-muted-foreground uppercase tracking-wider pb-2.5">
                  Trip
                </th>
                <th className="text-right text-[11px] font-semibold text-muted-foreground uppercase tracking-wider pb-2.5">
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
                      <div className="w-7 h-7 rounded-full bg-primary text-primary-foreground border-2 border-border-strong grid place-items-center text-[10px] font-semibold flex-shrink-0">
                        {r.initials}
                      </div>
                      <span className="font-semibold">{r.name}</span>
                    </div>
                  </td>
                  <td className="text-right text-muted-foreground tabular-nums font-mono text-xs">
                    {r.trips}
                  </td>
                  <td className="text-right font-semibold text-primary tabular-nums font-mono text-xs">
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
        <div className="rounded-xl border-[3px] border-border-strong bg-card p-5 shadow-[6px_6px_0_0_var(--color-border-strong)]">
          <h3 className="text-sm font-semibold mb-3">{t("dash.needsAttention")}</h3>
          <div className="space-y-1.5">
            {alerts.map((a, i) => (
              <div
                key={i}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs leading-relaxed ${alertStyles[a.type]}`}
              >
                {a.text}
              </div>
            ))}
          </div>
        </div>

        {/* Tunggakan */}
        <div className="rounded-xl border-[3px] border-border-strong bg-card p-5 shadow-[6px_6px_0_0_var(--color-border-strong)]">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold">{t("dash.biggestArrears")}</h3>
            <Link
              to="/admin/deductions"
              className="text-xs text-primary font-semibold hover:underline"
            >
              {t("btn.viewAll")}
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
                    installments: `3 ${t("dash.installmentsLeft")}`,
                  },
                  {
                    name: "Gilang A.",
                    remaining: 5,
                    total: 8,
                    amount: "720rb",
                    installments: `5 ${t("dash.installmentsLeft")}`,
                  },
                  {
                    name: "Hadi S.",
                    remaining: 2,
                    total: 4,
                    amount: "650rb",
                    installments: `2 ${t("dash.installmentsLeft")}`,
                  },
                  {
                    name: "Irwan T.",
                    remaining: 4,
                    total: 6,
                    amount: "580rb",
                    installments: `4 ${t("dash.installmentsLeft")}`,
                  },
                ]
            ).map((item) => (
              <div
                key={item.name}
                className="flex items-center justify-between py-2.5 border-b border-border last:border-b-0"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-semibold">{item.name}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{item.installments}</div>
                  <div className="h-[3px] bg-border rounded-full mt-1 w-full">
                    <div
                      className="h-full bg-destructive rounded-full"
                      style={{
                        width: `${(item.remaining / item.total) * 100}%`,
                      }}
                    />
                  </div>
                </div>
                <span className="text-[12px] font-bold text-destructive tabular-nums ml-3 flex-shrink-0 font-mono">
                  {item.amount}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Supabase warning */}
      {!isSupabaseConnected && (
        <div className="rounded-md border-2 border-border-strong bg-secondary p-4 mt-5">
          <div className="text-sm font-medium text-foreground mb-1">
            Hubungkan Supabase untuk data real
          </div>
          <p className="text-xs text-muted-foreground">
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
