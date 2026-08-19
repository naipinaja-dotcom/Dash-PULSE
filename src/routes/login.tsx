import { createFileRoute, useNavigate, Navigate } from "@tanstack/react-router";
import { useState } from "react";
import { usePostHog } from "@posthog/react";
import { useAuth } from "@/lib/auth";
import { setFirstTimeRiderPin, riderForgotPin, adminResetPassword } from "@/lib/api/rider-auth.functions";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/login")({
  component: LoginPage,
  head: () => ({
    meta: [
      { title: "Masuk — Dash PULSE" },
      {
        name: "description",
        content:
          "Masuk ke Dash PULSE sebagai admin untuk mengakses dashboard payroll, attendance, dan slip gaji.",
      },
      { property: "og:title", content: "Masuk — Dash PULSE" },
      { property: "og:description", content: "Masuk ke Dash PULSE sebagai admin." },
      { property: "og:url", content: "https://price-set-show.lovable.app/login" },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "canonical", href: "https://price-set-show.lovable.app/login" }],
  }),
});

function LoginPage() {
  const { user, loginAdmin, loginRider, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const posthog = usePostHog();
  const [mode, setMode] = useState<"admin" | "rider">("admin");
  const [riderSubMode, setRiderSubMode] = useState<"login" | "firstTime">("login");
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotPhone, setForgotPhone] = useState("");
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotNewPw, setForgotNewPw] = useState("");
  const [forgotNewPwConfirm, setForgotNewPwConfirm] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [pin, setPin] = useState("");
  const [phone, setPhone] = useState("");
  const [newPin, setNewPin] = useState("");
  const [newPinConfirm, setNewPinConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { t } = useT();

  if (authLoading) return null;
  if (user)
    return <Navigate to={user.role === "admin" ? "/admin/dashboard" : "/rider/dashboard"} />;

  const submitForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (mode === "admin") {
        if (!forgotEmail || !forgotNewPw) throw new Error(t("forgot.fieldsRequired"));
        if (forgotNewPw.length < 6) throw new Error(t("forgot.pwMinLength"));
        if (forgotNewPw !== forgotNewPwConfirm) throw new Error(t("forgot.pwMismatch"));
        await adminResetPassword({ data: { email: forgotEmail, newPassword: forgotNewPw } });
        toast.success(t("forgot.pwReset"));
        setForgotMode(false);
      } else {
        if (!employeeId || !forgotPhone) throw new Error(t("forgot.fieldsRequired"));
        await riderForgotPin({ data: { employeeId, phone: forgotPhone } });
        toast.success(t("forgot.pinReset"));
        setForgotMode(false);
        setRiderSubMode("firstTime");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("login.failed"));
    } finally {
      setSubmitting(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (mode === "admin") {
        if (!email || !password) throw new Error(t("login.emailRequired"));
        await loginAdmin(email, password);
        posthog.capture("user_logged_in", { role: "admin" });
        toast.success(t("login.success"));
        navigate({ to: "/admin/dashboard" });
      } else if (riderSubMode === "login") {
        if (!employeeId || !pin) throw new Error(t("login.riderRequired"));
        await loginRider(employeeId, pin);
        posthog.capture("user_logged_in", { role: "rider" });
        toast.success(t("login.success"));
        navigate({ to: "/rider/dashboard" });
      } else {
        if (!employeeId || !phone || !newPin) throw new Error(t("login.allFieldsRequired"));
        if (newPin !== newPinConfirm) throw new Error(t("login.pinMismatch"));
        if (!/^\d{4,8}$/.test(newPin)) throw new Error(t("login.pinFormat"));
        await setFirstTimeRiderPin({ data: { employeeId, phone, newPin } });
        await loginRider(employeeId, newPin);
        posthog.capture("user_logged_in", { role: "rider", first_time_pin: true });
        toast.success(t("login.pinCreated"));
        navigate({ to: "/rider/dashboard" });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("login.failed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen grid grid-rows-[auto_1fr] lg:grid-rows-none lg:grid-cols-2 bg-background">
      <div className="lg:hidden flex flex-col items-center text-center gap-3 px-6 pt-10 pb-8 bg-primary text-primary-foreground rounded-b-3xl">
        <img
          src="/dash-logo.png"
          alt="DASH"
          className="h-9 w-auto"
          style={{ filter: "brightness(0) invert(1)" }}
        />
        <p className="text-[11px] font-semibold uppercase tracking-[0.15em] opacity-90">
          OES Platform · Rider
        </p>
        <p className="text-sm font-medium opacity-95 max-w-xs">
          {t("login.tagline")}
        </p>
      </div>

      <div className="hidden lg:flex flex-col justify-between p-12 bg-primary text-primary-foreground">
        <div className="flex items-center gap-3">
          <img
            src="/dash-logo.png"
            alt="DASH"
            className="h-8 w-auto"
            style={{ filter: "brightness(0) invert(1)" }}
          />
          <div className="text-xs font-semibold opacity-95">PT. Dash Elektrik Indonesia</div>
        </div>
        <div>
          <h2 className="text-3xl font-bold leading-tight mb-3">
            {t("login.heroTitle1")}
            <br />
            {t("login.heroTitle2")}
          </h2>
          <p className="text-sm font-medium opacity-95 max-w-sm">
            {t("login.heroDesc")}
          </p>
        </div>
        <div className="text-xs opacity-85">
          © {new Date().getFullYear()} PT. Dash Elektrik Indonesia
        </div>
      </div>

      <div className="flex items-center justify-center p-6">
        {forgotMode ? (
          <form onSubmit={submitForgot} className="w-full max-w-sm">
            <h1 className="text-xl font-semibold mb-1">{t("forgot.title")}</h1>
            <p className="text-sm text-muted-foreground mb-4">
              {mode === "admin" ? t("forgot.adminDesc") : t("forgot.riderDesc")}
            </p>

            <div className="flex w-full max-w-[220px] border-2 border-border-strong rounded-md bg-card shadow-[4px_4px_0_0_var(--color-border-strong)] mb-4 overflow-hidden">
              {([ ["admin", "Admin"], ["rider", "Rider"] ] as const).map(([k, l]) => (
                <button key={k} type="button" onClick={() => setMode(k)}
                  className={`flex-1 px-3 py-1.5 text-sm font-bold border-l-2 border-border-strong first:border-l-0 transition-colors ${mode === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
                  {l}
                </button>
              ))}
            </div>

            {mode === "admin" ? (
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium">{t("login.email")}</label>
                  <input type="email" value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)}
                    placeholder="admin@dash.id"
                    className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
                </div>
                <div>
                  <label className="text-sm font-medium">{t("forgot.newPassword")}</label>
                  <input type="password" value={forgotNewPw} onChange={(e) => setForgotNewPw(e.target.value)}
                    placeholder="Min. 6 karakter"
                    className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
                </div>
                <div>
                  <label className="text-sm font-medium">{t("forgot.confirmPassword")}</label>
                  <input type="password" value={forgotNewPwConfirm} onChange={(e) => setForgotNewPwConfirm(e.target.value)}
                    placeholder="••••••••"
                    className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium">{t("login.riderCode")}</label>
                  <input value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} placeholder="MTR0001"
                    className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
                </div>
                <div>
                  <label className="text-sm font-medium">{t("login.whatsapp")}</label>
                  <input value={forgotPhone} onChange={(e) => setForgotPhone(e.target.value)} placeholder="0812..."
                    className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
                </div>
              </div>
            )}

            <button type="submit" disabled={submitting}
              className="mt-5 w-full rounded-md bg-primary text-primary-foreground py-2 text-sm font-medium hover:opacity-90 disabled:opacity-60 flex items-center justify-center gap-2">
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {mode === "admin" ? t("forgot.resetPassword") : t("forgot.resetPin")}
            </button>
            <button type="button" onClick={() => setForgotMode(false)} className="mt-3 w-full text-xs text-primary hover:underline">
              {t("forgot.backToLogin")}
            </button>
          </form>
        ) : (
          <form onSubmit={submit} className="w-full max-w-sm">
            <h1 className="text-xl font-semibold mb-1">{t("login.title")}</h1>
            <p className="text-sm text-muted-foreground mb-4">
              {mode === "admin"
                ? t("login.adminDesc")
                : riderSubMode === "login"
                  ? t("login.riderDesc")
                  : t("login.firstTimeDesc")}
            </p>

            <div className="flex w-full max-w-[220px] border-2 border-border-strong rounded-md bg-card shadow-[4px_4px_0_0_var(--color-border-strong)] mb-4 overflow-hidden">
              {([ ["admin", "Admin"], ["rider", "Rider"] ] as const).map(([k, l]) => (
                <button key={k} type="button" onClick={() => { setMode(k); setRiderSubMode("login"); }}
                  className={`flex-1 px-3 py-1.5 text-sm font-bold border-l-2 border-border-strong first:border-l-0 transition-colors ${mode === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
                  {l}
                </button>
              ))}
            </div>

            {mode === "admin" ? (
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium">{t("login.email")}</label>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@dash.id"
                    className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
                </div>
                <div>
                  <label className="text-sm font-medium">{t("login.password")}</label>
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"
                    className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
                </div>
                <button type="button" onClick={() => setForgotMode(true)} className="text-xs text-primary hover:underline">
                  {t("forgot.title")}?
                </button>
              </div>
            ) : riderSubMode === "login" ? (
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium">{t("login.riderCode")}</label>
                  <input value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} placeholder="MTR0001"
                    className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
                </div>
                <div>
                  <label className="text-sm font-medium">{t("login.pin")}</label>
                  <input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="••••"
                    className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
                </div>
                <div className="flex gap-3">
                  <button type="button" onClick={() => setRiderSubMode("firstTime")} className="text-xs text-primary hover:underline">
                    {t("login.firstTimeLink")}
                  </button>
                  <button type="button" onClick={() => setForgotMode(true)} className="text-xs text-primary hover:underline">
                    {t("forgot.title")}?
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium">{t("login.riderCode")}</label>
                  <input value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} placeholder="MTR0001"
                    className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
                </div>
                <div>
                  <label className="text-sm font-medium">{t("login.whatsapp")}</label>
                  <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0812..."
                    className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
                </div>
                <div>
                  <label className="text-sm font-medium">{t("login.newPin")}</label>
                  <input type="password" inputMode="numeric" value={newPin} onChange={(e) => setNewPin(e.target.value)} placeholder="4-8 digit"
                    className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
                </div>
                <div>
                  <label className="text-sm font-medium">{t("login.confirmPin")}</label>
                  <input type="password" inputMode="numeric" value={newPinConfirm} onChange={(e) => setNewPinConfirm(e.target.value)} placeholder="4-8 digit"
                    className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
                </div>
                <button type="button" onClick={() => setRiderSubMode("login")} className="text-xs text-primary hover:underline">
                  {t("login.alreadyHavePin")}
                </button>
              </div>
            )}

            <button type="submit" disabled={submitting}
              className="mt-5 w-full rounded-md bg-primary text-primary-foreground py-2 text-sm font-medium hover:opacity-90 disabled:opacity-60 flex items-center justify-center gap-2">
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {mode === "rider" && riderSubMode === "firstTime" ? t("login.createPinSubmit") : t("login.submit")}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
