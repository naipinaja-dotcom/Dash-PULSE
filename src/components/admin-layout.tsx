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
  Palette,
  Zap,
} from "lucide-react";
import { useEffect, useState, useCallback, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { usePayrollOverdue } from "@/lib/use-payroll-overdue";
import { useT, LangToggle } from "@/lib/i18n";

type NavMode = "payroll" | "intelligence";
const NAV_MODE_KEY = "dash-admin-nav-mode";
const COLLAPSED_KEY = "dash-admin-sidebar-collapsed";
const THEME_KEY = "dash-theme";
const DESIGN_KEY = "dash-design";
type Design = "brutal" | "classic";

const NAV_PAYROLL = [
  { to: "/admin/dashboard", labelKey: "nav.dashboard", icon: LayoutDashboard, sectionKey: "section.operations" },
  { to: "/admin/riders", labelKey: "nav.riders", icon: UserCircle2, sectionKey: "section.operations" },
  { to: "/admin/clients", labelKey: "nav.clients", icon: Users, sectionKey: "section.operations" },
  { to: "/admin/pricing", labelKey: "nav.pricing", icon: Tag, sectionKey: "section.pricing" },
  { to: "/admin/upload", labelKey: "nav.upload", icon: Upload, sectionKey: "section.payroll" },
  { to: "/admin/payroll", labelKey: "nav.payrollRun", icon: Calculator, sectionKey: "section.payroll" },
  { to: "/admin/data-check", labelKey: "nav.dataCheck", icon: Search, sectionKey: "section.payroll" },
  { to: "/admin/calculate", labelKey: "nav.calculate", icon: Coins, sectionKey: "section.payroll" },
  { to: "/admin/deductions", labelKey: "nav.deductions", icon: Wallet, sectionKey: "section.payroll" },
  { to: "/admin/reports", labelKey: "nav.reports", icon: FileBarChart2, sectionKey: "section.system" },
  { to: "/admin/reminders", labelKey: "nav.reminders", icon: BellRing, sectionKey: "section.system" },
  { to: "/admin/users", labelKey: "nav.userMgmt", icon: ShieldCheck, sectionKey: "section.system" },
] as const;

const NAV_INTELLIGENCE = [
  { to: "/admin/pnl-dashboard", labelKey: "nav.execDashboard", icon: LayoutPanelTop, sectionKey: "section.overview" },
  { to: "/admin/coo-insights", labelKey: "nav.opsInsight", icon: Sparkles, sectionKey: "section.overview" },
  { to: "/admin/pnl", labelKey: "nav.marginAnalytics", icon: TrendingUp, sectionKey: "section.analytics" },
  { to: "/admin/revenue-analytics", labelKey: "nav.revenueAnalytics", icon: Banknote, sectionKey: "section.analytics" },
  { to: "/admin/bcr-analytics", labelKey: "nav.bcrAnalytics", icon: Percent, sectionKey: "section.analytics" },
  { to: "/admin/shipment-analytics", labelKey: "nav.shipmentAnalytics", icon: Package, sectionKey: "section.analytics" },
  { to: "/admin/driver-analytics", labelKey: "nav.driverAnalytics", icon: Bike, sectionKey: "section.analytics" },
  { to: "/admin/invoices", labelKey: "nav.invoices", icon: Receipt, sectionKey: "section.finance" },
] as const;

type NavItem = (typeof NAV_PAYROLL)[number] | (typeof NAV_INTELLIGENCE)[number];

function modeForPath(pathname: string): NavMode {
  return NAV_INTELLIGENCE.some((it) => pathname === it.to || pathname.startsWith(it.to + "/"))
    ? "intelligence"
    : "payroll";
}

function groupNavItems(items: readonly NavItem[]) {
  const groups: { sectionKey: string; items: NavItem[] }[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last?.sectionKey === item.sectionKey) last.items.push(item);
    else groups.push({ sectionKey: item.sectionKey, items: [item] });
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

// ── Design toggle (data-design attribute on <html>) ────────────────────────
function initDesign() {
  if (typeof window === "undefined") return;
  const stored = localStorage.getItem(DESIGN_KEY) as Design | null;
  document.documentElement.setAttribute("data-design", stored ?? "brutal");
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

  const [design, setDesign] = useState<Design>(() => {
    if (typeof window === "undefined") return "brutal";
    return (localStorage.getItem(DESIGN_KEY) as Design | null) ?? "brutal";
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

  useEffect(() => {
    document.documentElement.setAttribute("data-design", design);
    localStorage.setItem(DESIGN_KEY, design);
  }, [design]);

  // Apply theme on first mount (handles SSR/hydration gap)
  useEffect(() => {
    initTheme();
    initDesign();
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

  const { t } = useT();
  const navItems: readonly NavItem[] = mode === "payroll" ? NAV_PAYROLL : NAV_INTELLIGENCE;
  const navGroups = groupNavItems(navItems);

  // ── Sidebar shared content ──────────────────────────────────────────────
  const SidebarContent = ({ mobile = false }: { mobile?: boolean }) => (
    <>
      {/* Brand */}
      <div
        className={`admin-brand flex items-center gap-3 border-b border-border ${collapsed && !mobile ? "px-4 py-[18px] justify-center" : "px-5 py-[18px]"}`}
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
          <div className="admin-mode-switch grid grid-cols-2">
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
                  "text-[12px] font-bold py-1.5 transition-colors duration-150 " +
                  (mode === m
                    ? "admin-mode-active bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground")
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
      <nav className="admin-nav flex-1 px-2.5 py-3 overflow-y-auto space-y-3">
        {navGroups.map(({ sectionKey, items }) => (
          <div key={sectionKey}>
            {(!collapsed || mobile) && (
              <div className="admin-section-label px-3 pb-1 pt-0.5 text-[10px] font-extrabold text-primary uppercase tracking-widest">
                {t(sectionKey as any)}
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
                    title={collapsed && !mobile ? t(it.labelKey as any) : undefined}
                    className={
                      "admin-nav-item flex items-center rounded-md text-[13px] transition-colors duration-150 " +
                      (collapsed && !mobile
                        ? "justify-center px-0 py-2"
                        : "gap-2.5 px-3 py-[7px]") +
                      " " +
                      (active ? "admin-nav-active" : "text-foreground/70")
                    }
                  >
                    <Icon
                      className={`flex-shrink-0 ${collapsed && !mobile ? "w-[18px] h-[18px]" : "w-4 h-4"}`}
                    />
                    {(!collapsed || mobile) && <span>{t(it.labelKey as any)}</span>}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* User footer */}
      <div className="admin-sidebar-footer p-3">
        {!collapsed || mobile ? (
          <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-muted/60 transition-colors">
            <div className="admin-avatar-orb w-7 h-7 rounded-full bg-primary text-primary-foreground grid place-items-center text-[11px] font-bold flex-shrink-0">
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
    <div className="admin-shell flex min-h-screen w-full bg-background">
      <div className="admin-ambient" aria-hidden="true">
        <span className="admin-ambient-orb admin-ambient-orb-a" />
        <span className="admin-ambient-orb admin-ambient-orb-b" />
        <span className="admin-ambient-grid" />
      </div>
      {/* Desktop sidebar */}
      <aside
        className={`admin-sidebar hidden lg:flex flex-col bg-sidebar flex-shrink-0 transition-[width] duration-250 ease-[cubic-bezier(0.4,0,0.2,1)] ${collapsed ? "w-[72px]" : "w-60"}`}
      >
        <SidebarContent />
      </aside>

      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-foreground/40" onClick={() => setMobileOpen(false)} />
          <aside className="admin-sidebar absolute left-0 top-0 bottom-0 w-64 bg-sidebar border-r border-border flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <span className="text-sm font-semibold">Dash PULSE</span>
              <button onClick={() => setMobileOpen(false)} className="p-1" aria-label={t("btn.closeMenu")}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <SidebarContent mobile />
          </aside>
        </div>
      )}

      {/* Main area */}
      <div className="admin-main flex-1 flex flex-col min-w-0">
        <header className="admin-header sticky top-0 z-10 h-14 flex items-center px-4 lg:px-6 gap-3">
          {/* Mobile hamburger */}
          <button
            className="lg:hidden p-1.5 -ml-1 rounded-md hover:bg-muted"
            onClick={() => setMobileOpen(true)}
            aria-label={t("btn.openMenu")}
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
              className="admin-page-title text-[17px] font-bold leading-tight truncate"
              style={{ fontFamily: "'Sora','Manrope','Segoe UI',sans-serif" }}
            >
              {title}
            </h1>
            {subtitle && (
              <p className="admin-page-subtitle text-[11px] text-muted-foreground truncate mt-0.5">{subtitle}</p>
            )}
          </div>

          <div className="admin-header-context hidden xl:flex items-center gap-2" aria-label="DASH operations">
            <span className="admin-live-dot" />
            <span>DASH OPERATIONS</span>
          </div>

          {/* Payroll overdue badge — cuma relevan di mode Payroll, gak nyambung sama sekali di mode PnL/Intelligence */}
          {mode === "payroll" && overdue.overdue && (
            <Link
              to="/admin/payroll"
              className="inline-flex items-center gap-1.5 rounded-lg border-2 border-border-strong bg-warning px-3 py-1.5 text-xs font-bold text-warning-foreground hover:brightness-105 transition-[filter] flex-shrink-0"
              title={`Payroll run belum dibuat. Period terakhir berakhir ${overdue.lastPeriodEnd}.`}
            >
              <Bell className="w-3.5 h-3.5 animate-pulse" />
              <span className="hidden sm:inline">Payroll terlambat {overdue.daysLate} hari</span>
              <span className="sm:hidden">Payroll!</span>
            </Link>
          )}

          <LangToggle />

          {/* Design toggle: Neo Brutalism vs Glass */}
          <button
            onClick={() => setDesign((d) => (d === "brutal" ? "classic" : "brutal"))}
            className="flex items-center justify-center w-8 h-8 rounded-md border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
            aria-label={design === "brutal" ? "Tema Neo Brutal aktif — ganti ke tema Glass" : "Tema Glass aktif — ganti ke tema Neo Brutal"}
            aria-pressed={design === "brutal"}
            title={design === "brutal" ? "Tema: Neo Brutal — ganti ke Glass" : "Tema: Glass — ganti ke Neo Brutal"}
          >
            {design === "brutal" ? <Palette className="w-4 h-4" /> : <Zap className="w-4 h-4" />}
          </button>

          {/* Dark mode toggle */}
          <button
            onClick={() => setDark((d) => !d)}
            className="flex items-center justify-center w-8 h-8 rounded-md border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
            aria-label={dark ? t("theme.light") : t("theme.dark")}
            title={dark ? t("theme.light") : t("theme.dark")}
          >
            {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </header>

        <main className="admin-content flex-1 px-4 lg:px-8 py-6 overflow-x-hidden">{children}</main>
      </div>
    </div>
  );
}
