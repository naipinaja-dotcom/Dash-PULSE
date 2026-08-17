import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AdminLayout } from "@/components/admin-layout";
import { DTypesTab } from "@/components/deductions/d-types-tab";
import { AddTab } from "@/components/deductions/add-tab";
import { ActiveTab } from "@/components/deductions/active-tab";
import { RecapTab } from "@/components/deductions/recap-tab";
import { ArrearsTab } from "@/components/deductions/arrears-tab";
import { MolisTypesTab } from "@/components/deductions/molis-types-tab";
import { RecipientsTab } from "@/components/deductions/recipients-tab";
import { KasbonSettlementTab, KasbonLunasTab } from "@/components/deductions/kasbon-recap-tabs";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/admin/deductions")({ component: DeductionsPage });

function DeductionsPage() {
  const { t } = useT();
  const [tab, setTab] = useState<"types" | "molis" | "add" | "active" | "arrears" | "recap" | "recipients" | "settlement" | "lunas">("types");
  return (
    <AdminLayout title={t("ded.title")} subtitle={t("ded.subtitle")}>
      <div className="deductions-workspace">
        <div className="inline-flex flex-wrap border-2 border-border-strong rounded-md bg-card shadow-[4px_4px_0_0_var(--color-border-strong)] w-fit mb-5 overflow-hidden">
          {(
            [
              ["types", t("ded.tabTypes")],
              ["molis", t("ded.tabMolis")],
              ["add", t("ded.tabAdd")],
              ["active", t("ded.tabActive")],
              ["arrears", t("ded.tabArrears")],
              ["recap", t("ded.tabRecap")],
              ["recipients", t("ded.tabRecipients")],
              ["settlement", t("ded.tabSettlement")],
              ["lunas", t("ded.tabLunas")],
            ] as [string, string][]
          ).map(([k, l]) => (
            <button
              key={k}
              onClick={() => setTab(k as any)}
              className={`px-4 py-1.5 text-sm font-bold border-l-2 border-border-strong first:border-l-0 transition-colors ${tab === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
            >
              {l}
            </button>
          ))}
        </div>
        <section className={`deductions-panel${tab === "add" ? " deductions-panel--form" : ""}`}>
          {tab === "add" && (
            <div className="deductions-panel-heading">
              <span data-eyebrow>Setup potongan</span>
              <h2>Atur potongan rider</h2>
              <p>Pilih rider, tentukan skema, lalu isi nominal dan tanggal mulai.</p>
            </div>
          )}
          {tab === "types" && <DTypesTab />}
          {tab === "molis" && <MolisTypesTab />}
          {tab === "add" && <AddTab />}
          {tab === "active" && <ActiveTab />}
          {tab === "arrears" && <ArrearsTab onGoToActiveTab={() => setTab("active")} />}
          {tab === "recap" && <RecapTab />}
          {tab === "recipients" && <RecipientsTab />}
          {tab === "settlement" && <KasbonSettlementTab />}
          {tab === "lunas" && <KasbonLunasTab />}
        </section>
      </div>
    </AdminLayout>
  );
}
