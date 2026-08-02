import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AdminLayout } from "@/components/admin-layout";
import { DTypesTab } from "@/components/deductions/d-types-tab";
import { AddTab } from "@/components/deductions/add-tab";
import { ActiveTab } from "@/components/deductions/active-tab";
import { RecapTab } from "@/components/deductions/recap-tab";
import { MolisTypesTab } from "@/components/deductions/molis-types-tab";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/admin/deductions")({ component: DeductionsPage });

function DeductionsPage() {
  const { t } = useT();
  const [tab, setTab] = useState<"types" | "molis" | "add" | "active" | "recap">("types");
  return (
    <AdminLayout title={t("ded.title")} subtitle={t("ded.subtitle")}>
      <div className="flex gap-1 p-1 bg-muted rounded-md w-fit mb-5">
        {(
          [
            ["types", t("ded.tabTypes")],
            ["molis", "Jenis Molis"],
            ["add", t("ded.tabAdd")],
            ["active", t("ded.tabActive")],
            ["recap", t("ded.tabRecap")],
          ] as [string, string][]
        ).map(([k, l]) => (
          <button
            key={k}
            onClick={() => setTab(k as any)}
            className={`px-4 py-1.5 text-sm rounded ${tab === k ? "bg-card shadow-sm font-medium" : "text-muted-foreground"}`}
          >
            {l}
          </button>
        ))}
      </div>
      {tab === "types" && <DTypesTab />}
      {tab === "molis" && <MolisTypesTab />}
      {tab === "add" && <AddTab />}
      {tab === "active" && <ActiveTab />}
      {tab === "recap" && <RecapTab />}
    </AdminLayout>
  );
}
