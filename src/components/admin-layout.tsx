import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Users,
  UserCircle2,
  Tag,
  Upload,
  Wallet,
  FileBarChart2,
  Calculator,
  Coins,
  TrendingUp,
  LayoutPanelTop,
  ShieldCheck,
  Search,
  Receipt,
  LogOut,
  Menu,
  X,
  Package,
  Banknote,
  Percent,
  Bike,
  Bell,
  BellRing,
  ChevronLeft,
  ChevronRight,
  Moon,
  Sun,
  Sparkles,
} from "lucide-react";
import { useEffect, useState, useCallback, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { usePayrollOverdue } from "@/lib/use-payroll-overdue";

type NavMode = "payroll" | "intelligence";
const NAV_MODE_KEY = "dash-admin-nav-mode";
const COLLAPSED_KEY = "dash-admin-sidebar-collapsed";
const THEME_KEY = "dash-theme";

const NAV_PAYROLL = [
  {
    to: "/admin/dashboard",
    label: "Payroll Dashboard",
    icon: LayoutDashboard,
    section: "OPERATIONS",
  },
  { to: "/admin/riders", label: "Riders", icon: UserCircle2, section: "OPERATIONS" },
  { to: "/admin/clients", label: "Clients", icon: Users, section: "OPERATIONS" },
  { to: "/admin/pricing", label: "Pricing Schemes", icon: Tag, section: "PRICING" },
  { to: "/admin/upload", label: "Upload Data", icon: Upload, section: "PAYROLL" },
  { to: "/admin/payroll", label: "Payroll Run", icon: Calculator, section: "PAYROLL" },
  { to: "/admin/data-check", label: "Cek Data", icon: Search, section: "PAYROLL" },
  { to: "/admin/calculate", label: "Hitung Fee", icon: Coins, section: "PAYROLL" },
  { to: "/admin/deductions", label: "Deductions", icon: Wallet, section: "PAYROLL" },
  { to: "/admin/reports", label: "Reports", icon: FileBarChart2, section: "SYSTEM" },
  { to: "/admin/reminders", label: "Reminders", icon: BellRing, section: "SYSTEM" },
  { to: "/admin/users", label: "User Management", icon: ShieldCheck, section: "SYSTEM" },
] as const;

const NAV_INTELLIGENCE = [
  {
    to: "/admin/pnl-dashboard",
    label: "Executive Dashboard",
    icon: LayoutPanelTop,
    section: "OVERVIEW",
  },
  { to: "/admin/coo-insights", label: "Ops Insight", icon: Sparkles, section: "OVERVIEW" },
  { to: "/admin/pnl", label: "Margin Analytics", icon: TrendingUp, section: "ANALYTICS" },
  {
    to: "/admin/revenue-analytics",
    label: "Revenue Analytics",
    icon: Banknote,
    section: "ANALYTICS",
  },
  { to: "/admin/bcr-analytics", label: "BCR Analytics", icon: Percent, section: "ANALYTICS" },
  {
    to: "/admin/shipment-analytics",
    label: "Shipment Analytics",
    icon: Package,
    section: "ANALYTICS",
  },
  { to: "/admin/driver-analytics", label: "Driver Analytics", icon: Bike, section: "ANALYTICS" },
  { to: "/admin/invoices", label: "Invoices", icon: Receipt, section: "FINANCE" },
] as const;

type NavItem = (typeof NAV_PAYROLL)[number] | (typeof NAV_INTELLIGENCE)[number];

function modeForPath(pathname: string): NavMode {
  return NAV_INTELLIGENCE.some((it) => pathname === it.to || pathname.startsWith(it.to + "/"))
    ? "intelligence"
    : "payroll";
}

function groupNavItems(items: readonly NavItem[]) {
  const groups: { section: string; items: NavItem[] }[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last?.section === item.section) last.items.push(item);
    else groups.push({ section: item.section, items: [item] });
  }
  return groups;
}

// ── Dark mode helper (toggle class on <html>) ──────────────────────────────
function initTheme() {
  if (typeof window === "undefined") return;
  const stored = localStorage.getItem(THEME_KEY);
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const dark = stored ? stored === "dark" : prefersDark;
  document.documentElement.classList.toggle("dark", dark);
}

export function AdminLayout({
  children,
  title,
  subtitle,
}: {
  children: ReactNode;
  title: string;
  subtitle?: string;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const overdue = usePayrollOverdue();

  const [mobileOpen, setMobileOpen] = useState(false);

  const [mode, setMode] = useState<NavMode>(() => {
    if (typeof window === "undefined") return modeForPath(pathname);
    const s = localStorage.getItem(NAV_MODE_KEY);
    return s === "payroll" || s === "intelligence" ? s : modeForPath(pathname);
  });

  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(COLLAPSED_KEY) === "true";
  });

  const [dark, setDark] = useState(() => {
    if (typeof window === "undefined") return false;
    const s = localStorage.getItem(THEME_KEY);
    return s ? s === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  // Sync mode when navigating via back/forward
  useEffect(() => {
    setMode(modeForPath(pathname));
  }, [pathname]);

  useEffect(() => {
    localStorage.setItem(NAV_MODE_KEY, mode);
  }, [mode]);
  useEffect(() => {
    localStorage.setItem(COLLAPSED_KEY, String(collapsed));
  }, [collapsed]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
  }, [dark]);

  // Apply theme on first mount (handles SSR/hydration gap)
  useEffect(() => {
    initTheme();
  }, []);

  const switchMode = useCallback(
    (m: NavMode) => {
      if (m === mode) return;
      setMode(m);
      const target = m === "payroll" ? NAV_PAYROLL[0].to : NAV_INTELLIGENCE[0].to;
      navigate({ to: target });
    },
    [mode, navigate],
  );

  const handleLogout = () => {
    logout();
    navigate({ to: "/login" });
  };

  const navItems: readonly NavItem[] = mode === "payroll" ? NAV_PAYROLL : NAV_INTELLIGENCE;
  const navGroups = groupNavItems(navItems);

  // ── Sidebar shared content ──────────────────────────────────────────────
  const SidebarContent = ({ mobile = false }: { mobile?: boolean }) => (
    <>
      {/* Brand */}
      <div
        className={`flex items-center gap-3 border-b border-border ${collapsed && !mobile ? "px-4 py-[18px] justify-center" : "px-5 py-[18px]"}`}
      >
        <img src="/dash-icon.png" alt="DASH" className="w-9 h-9 flex-shrink-0 object-contain" />
        {(!collapsed || mobile) && (
          <div>
            <div
              className="text-[13px] font-bold leading-tight tracking-tight"
              style={{ fontFamily: "'Plus Jakarta Sans',sans-serif" }}
            >
              Dash PULSE
            </div>
            <div className="text-[10px] text-muted-foreground tracking-widest uppercase mt-0.5">
              PT. Dash Elektrik
            </div>
          </div>
        )}
      </div>

      {/* Mode toggle */}
      {!collapsed || mobile ? (
        <div className="px-3 pt-3">
          <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-muted">
            {(
              [
                ["payroll", "Payroll"],
                ["intelligence", "PnL"],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                type="button"
                onClick={() => switchMode(m)}
                className={
                  "text-[12px] font-semibold py-1.5 rounded-md transition-all duration-200 " +
                  (mode === m
                    ? "bg-primary text-primary-foreground shadow-[0_2px_8px_rgba(124,92,252,0.3)]"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="px-2 pt-3 flex flex-col gap-1">
          {(
            [
              ["payroll", LayoutDashboard],
              ["intelligence", TrendingUp],
            ] as const
          ).map(([m, Icon]) => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              title={m === "payroll" ? "Payroll Mode" : "PnL Mode"}
              className={
                "w-full flex justify-center p-2 rounded-lg transition-colors " +
                (mode === m
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground")
              }
            >
              <Icon className="w-4 h-4" />
            </button>
          ))}
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 px-2.5 py-3 overflow-y-auto space-y-3">
        {navGroups.map(({ section, items }) => (
          <div key={section}>
            {(!collapsed || mobile) && (
              <div className="px-3 pb-1 pt-0.5 text-[10px] font-bold text-muted-foreground/60 uppercase tracking-widest">
                {section}
              </div>
            )}
            <div className="space-y-0.5">
              {items.map((it) => {
                const Icon = it.icon;
                const active = pathname === it.to || pathname.startsWith(it.to + "/");
                return (
                  <Link
                    key={it.to}
                    to={it.to}
                    onClick={() => setMobileOpen(false)}
                    title={collapsed && !mobile ? it.label : undefined}
                    className={
                      "flex items-center rounded-md text-[13px] transition-all duration-150 " +
                      (collapsed && !mobile
                        ? "justify-center px-0 py-2.5"
                        : "gap-2.5 px-3 py-[7px]") +
                      " " +
                      (active
                        ? "bg-primary-soft text-primary-soft-foreground font-semibold"
                        : "text-foreground/65 hover:bg-muted/80 hover:text-foreground")
                    }
                  >
                    <Icon
                      className={`flex-shrink-0 ${collapsed && !mobile ? "w-[18px] h-[18px]" : "w-4 h-4"} ${active ? "text-primary" : ""}`}
                    />
                    {(!collapsed || mobile) && <span>{it.label}</span>}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* User footer */}
      <div className="border-t border-border p-3">
        {!collapsed || mobile ? (
          <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-muted/60 transition-colors">
            <div className="w-7 h-7 rounded-full bg-primary text-primary-foreground grid place-items-center text-[11px] font-bold flex-shrink-0">
              {user?.fullName?.charAt(0) ?? "A"}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-semibold truncate leading-tight">
                {user?.fullName ?? "Admin"}
              </div>
              <div className="text-[10px] text-muted-foreground truncate">Administrator</div>
            </div>
            <button
              onClick={handleLogout}
              className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-destructive transition-colors"
              title="Logout"
              aria-label="Logout"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <button
            onClick={handleLogout}
            className="w-full flex justify-center p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-muted transition-colors"
            title="Logout"
            aria-label="Logout"
          >
            <LogOut className="w-4 h-4" />
          </button>
        )}
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen w-full bg-background">
      {/* Desktop sidebar */}
      <aside
        className={`hidden lg:flex flex-col border-r border-border bg-sidebar shadow-[1px_0_0_0_var(--color-border)] flex-shrink-0 transition-[width] duration-250 ease-[cubic-bezier(0.4,0,0.2,1)] ${collapsed ? "w-[72px]" : "w-60"}`}
      >
        <SidebarContent />
      </aside>

      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-foreground/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-64 bg-sidebar border-r border-border flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <span className="text-sm font-semibold">Dash PULSE</span>
              <button onClick={() => setMobileOpen(false)} className="p-1" aria-label="Tutup menu">
                <X className="w-5 h-5" />
              </button>
            </div>
            <SidebarContent mobile />
          </aside>
        </div>
      )}

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-10 h-14 border-b border-border bg-card/85 backdrop-blur-md flex items-center px-4 lg:px-6 gap-3">
          {/* Mobile hamburger */}
          <button
            className="lg:hidden p-1.5 -ml-1 rounded-md hover:bg-muted"
            onClick={() => setMobileOpen(true)}
            aria-label="Buka menu"
          >
            <Menu className="w-5 h-5" />
          </button>

          {/* Sidebar collapse toggle (desktop) */}
          <button
            className="hidden lg:flex items-center justify-center w-7 h-7 -ml-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>

          <div className="min-w-0 flex-1">
            <h1
              className="text-[15px] font-bold leading-tight truncate tracking-tight"
              style={{ fontFamily: "'Plus Jakarta Sans',sans-serif" }}
            >
              {title}
            </h1>
            {subtitle && (
              <p className="text-[11px] text-muted-foreground truncate mt-0.5">{subtitle}</p>
            )}
          </div>

          {/* Payroll overdue badge — cuma relevan di mode Payroll, gak nyambung sama sekali di mode PnL/Intelligence */}
          {mode === "payroll" && overdue.overdue && (
            <Link
              to="/admin/payroll"
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 transition-colors flex-shrink-0"
              title={`Payroll run belum dibuat. Period terakhir berakhir ${overdue.lastPeriodEnd}.`}
            >
              <Bell className="w-3.5 h-3.5 animate-pulse" />
              <span className="hidden sm:inline">Payroll terlambat {overdue.daysLate} hari</span>
              <span className="sm:hidden">Payroll!</span>
            </Link>
          )}

          {/* Dark mode toggle */}
          <button
            onClick={() => setDark((d) => !d)}
            className="flex items-center justify-center w-8 h-8 rounded-md border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
            aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
            title={dark ? "Light mode" : "Dark mode"}
          >
            {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </header>

        <main className="flex-1 px-4 lg:px-8 py-6 overflow-x-hidden">{children}</main>
      </div>
    </div>
  );
}
