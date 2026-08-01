import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { LayoutDashboard, Receipt, User, LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { useT, LangToggle } from "@/lib/i18n";

const NAV = [
  { to: "/rider/dashboard", labelKey: "nav.beranda", icon: LayoutDashboard },
  { to: "/rider/payslips", labelKey: "nav.slipGaji", icon: Receipt },
  { to: "/rider/profile", labelKey: "nav.profil", icon: User },
] as const;

export function RiderLayout({ children, title }: { children: ReactNode; title: string }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { t } = useT();
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="h-14 border-b border-border bg-card flex items-center justify-between px-4 sticky top-0 z-10">
        <div>
          <h1 className="text-base font-semibold leading-tight">{title}</h1>
          <p className="text-[11px] text-muted-foreground">{user?.employeeId ?? user?.fullName}</p>
        </div>
        <div className="flex items-center gap-2">
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
      <main className="flex-1 pb-20 px-4 py-5 max-w-xl w-full mx-auto">{children}</main>
      <nav className="fixed bottom-0 inset-x-0 border-t border-border bg-card">
        <div className="max-w-xl mx-auto grid grid-cols-3">
          {NAV.map((it) => {
            const Icon = it.icon;
            const active = pathname === it.to;
            return (
              <Link
                key={it.to}
                to={it.to}
                className={
                  "flex flex-col items-center gap-1 py-2.5 text-[11px] " +
                  (active ? "text-primary font-medium" : "text-muted-foreground")
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
