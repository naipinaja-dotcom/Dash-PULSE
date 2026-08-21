import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { LayoutDashboard, Receipt, User, History, LogOut, Moon, Sun } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { useT, LangToggle } from "@/lib/i18n";

const NAV = [
  { to: "/rider/dashboard", labelKey: "nav.beranda", icon: LayoutDashboard },
  { to: "/rider/history", labelKey: "nav.riwayat", icon: History },
  { to: "/rider/payslips", labelKey: "nav.slipGaji", icon: Receipt },
  { to: "/rider/profile", labelKey: "nav.profil", icon: User },
] as const;

export function RiderLayout({ children, title }: { children: ReactNode; title: string }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { t } = useT();
  const [dark, setDark] = useState(() => {
    const stored = localStorage.getItem("dash-rider-theme");
    return stored ? stored === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("dash-rider-theme", dark ? "dark" : "light");
  }, [dark]);
  return (
    <div className="rider-shell relative isolate min-h-screen flex flex-col overflow-x-hidden">
      <header className="h-16 border-b border-border/50 bg-background/65 backdrop-blur-xl flex items-center justify-between px-5 sticky top-0 z-10">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary to-violet-500 text-primary-foreground grid place-items-center font-black text-sm shadow-lg shadow-primary/25">P</div>
          <div className="min-w-0">
            <p className="text-[9px] font-semibold tracking-[.16em] text-primary uppercase leading-none">DASH PULSE</p>
            <h1 className="text-sm font-bold leading-tight mt-1 truncate">{title}</h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setDark((value) => !value)}
            className="p-2 rounded-md hover:bg-muted text-muted-foreground transition-colors"
            aria-label={dark ? t("theme.light") : t("theme.dark")}
            title={dark ? t("theme.light") : t("theme.dark")}
          >
            {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <LangToggle />
          <button
            onClick={() => {
              logout();
              navigate({ to: "/login" });
            }}
            className="p-2 rounded-md hover:bg-muted text-muted-foreground"
            title={t("btn.logout")}
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>
      <main className="relative z-[1] flex-1 pb-28 px-4 py-6 max-w-xl w-full mx-auto">{children}</main>
      <nav className="fixed bottom-3 inset-x-3 max-w-[calc(36rem-1.5rem)] mx-auto rounded-[1.35rem] border border-border/80 bg-card/90 shadow-2xl shadow-black/15 backdrop-blur-xl overflow-hidden z-20">
        <div className="max-w-xl mx-auto grid grid-cols-4">
          {NAV.map((it) => {
            const Icon = it.icon;
            const active = pathname === it.to;
            return (
              <Link
                key={it.to}
                to={it.to}
                className={
                  "flex flex-col items-center gap-1 py-2.5 text-[10px] transition-all duration-200 " +
                  (active ? "m-1 rounded-[.9rem] bg-primary text-primary-foreground font-semibold shadow-md shadow-primary/25 -translate-y-0.5" : "text-muted-foreground hover:text-primary")
                }
              >
                <Icon className="w-5 h-5" />
                {t(it.labelKey)}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
