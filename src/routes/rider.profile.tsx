import { createFileRoute } from "@tanstack/react-router";
import { RiderLayout } from "@/components/rider-layout";
import { useAuth } from "@/lib/auth";
import { useRiderSelf } from "@/lib/use-rider-self";
import { useT } from "@/lib/i18n";
import { formatTanggal } from "@/lib/format";
import { BadgeCheck, Building2, Cake, IdCard, Loader2, Mail, Phone, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/rider/profile")({
  component: ProfilePage,
});

const STATUS_LABEL: Record<string, string> = {
  ready_to_work: "Ready to Work", active: "Active", resign: "Resign",
  blacklisted: "Blacklisted", withdrawn: "Withdrawn", suspended: "Suspend",
};

function ProfilePage() {
  const { t } = useT();
  const { user } = useAuth();
  const { rider, loading } = useRiderSelf();

  return (
    <RiderLayout title={t("profile.title")}>
      <div className="relative overflow-hidden rounded-[1.75rem] border-2 border-border-strong bg-gradient-to-br from-primary-soft via-card to-card px-5 py-7 shadow-[8px_8px_0_0_var(--color-border-strong)]">
        <div className="absolute -right-10 -top-12 h-36 w-36 rounded-full bg-primary/20 blur-2xl" />
        <div className="relative flex flex-col items-center">
        <div className="w-[4.5rem] h-[4.5rem] rounded-2xl border-2 border-border-strong bg-gradient-to-br from-primary to-violet-700 text-primary-foreground grid place-items-center text-2xl font-bold shadow-[3px_3px_0_0_var(--color-border-strong)]">
          {user?.fullName?.charAt(0) ?? "R"}
        </div>
        <div className="mt-3 text-base font-bold">{rider?.full_name ?? user?.fullName}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{rider?.employee_id ?? user?.employeeId}</div>
        <div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-border-strong bg-success/15 px-3 py-1 text-[10px] font-semibold text-success"><BadgeCheck className="w-3.5 h-3.5" />{rider ? (STATUS_LABEL[rider.status] ?? rider.status) : "Rider"}</div>
        </div>
      </div>
      {loading ? (
        <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : !rider ? (
        <p className="text-xs text-center text-muted-foreground">{t("profile.notLinked")}</p>
      ) : (
        <div className="mt-5 space-y-4">
          {[
            { k: t("profile.employeeId"), v: rider.employee_id, icon: IdCard },
            { k: t("profile.nik"), v: rider.nik ?? "-", icon: ShieldCheck },
            { k: t("profile.whatsapp"), v: rider.phone ?? "-", icon: Phone },
            { k: t("profile.email"), v: rider.email ?? "-", icon: Mail },
            { k: t("profile.bank"), v: rider.bank_name ? `${rider.bank_name} · ${rider.bank_account ?? "-"}` : "-", icon: Building2 },
            { k: t("profile.birthInfo"), v: rider.birth_place || rider.birth_date ? `${rider.birth_place ?? "-"}, ${rider.birth_date ? formatTanggal(rider.birth_date) : "-"}` : "-", icon: Cake },
            { k: t("profile.status"), v: STATUS_LABEL[rider.status] ?? rider.status, icon: BadgeCheck },
          ].map((r, index) => (
            <div key={r.k}>
              {(index === 0 || index === 4) && <p className="mb-2 text-[10px] font-semibold tracking-[.14em] uppercase text-primary">{index === 0 ? "Identitas & kontak" : "Pencairan & status"}</p>}
            <div className="flex items-center justify-between gap-3 rounded-2xl border-2 border-border-strong bg-card px-3 py-3 shadow-[4px_4px_0_0_var(--color-border-strong)] mb-2 transition-colors hover:border-primary/60">
              <div className="flex items-center gap-3 min-w-0"><span className="w-9 h-9 rounded-xl bg-primary/10 text-primary grid place-items-center flex-shrink-0"><r.icon className="w-4 h-4" /></span><span className="text-xs text-muted-foreground min-w-0">{r.k}</span></div>
              <span className="text-sm font-medium text-right min-w-0 break-words">{r.v}</span>
            </div>
            </div>
          ))}
        </div>
      )}
    </RiderLayout>
  );
}
