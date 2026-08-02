import { createFileRoute } from "@tanstack/react-router";
import { AdminLayout } from "@/components/admin-layout";
import { useT } from "@/lib/i18n";
import { PayrollReminderPanel } from "@/components/payroll-reminder-panel";

export const Route = createFileRoute("/admin/reminders")({ component: RemindersPage });

function RemindersPage() {
  const { t } = useT();
  return (
    <AdminLayout
      title={t("reminders.title")}
      subtitle={t("reminders.subtitle")}
    >
      <PayrollReminderPanel />
    </AdminLayout>
  );
}
