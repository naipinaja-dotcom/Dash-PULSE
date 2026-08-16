import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AdminLayout } from "@/components/admin-layout";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { formatRupiah } from "@/lib/format";
import {
  triggerCooInsightManual,
  listCooInsightReports,
  addIncidentReport,
  listIncidentReports,
  deleteIncidentReport,
} from "@/lib/api/coo-insight.functions";
import { toast } from "sonner";
import { confirmDialog } from "@/components/confirm-dialog";
import {
  Loader2,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Trash2,
  Plus,
} from "lucide-react";

export const Route = createFileRoute("/admin/coo-insights")({ component: CooInsightsPage });

type Severity = "HIGH" | "MEDIUM" | "LOW";
type IncidentType = "operational" | "financial" | "system" | "market";

type Incident = {
  id: string;
  week_start: string;
  week_end: string;
  type: IncidentType;
  description: string;
  severity: Severity;
  estimated_impact: number | null;
};

// Sama dgn defaultWeekRange di pnl-weekly-push.server.ts: 7 hari trailing.
// PENTING: pakai tanggal kalender LOKAL (bukan toISOString/UTC) — lihat
// use-intelligence-date.ts buat alasan lengkapnya.
function localDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function currentWeek(): { weekStart: string; weekEnd: string } {
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - 6);
  return { weekStart: localDate(start), weekEnd: localDate(end) };
}
function shiftWeek({ weekStart, weekEnd }: { weekStart: string; weekEnd: string }, days: number) {
  const start = new Date(`${weekStart}T00:00:00`);
  const end = new Date(`${weekEnd}T00:00:00`);
  start.setDate(start.getDate() + days);
  end.setDate(end.getDate() + days);
  return { weekStart: localDate(start), weekEnd: localDate(end) };
}

const SEVERITY_STYLE: Record<Severity, string> = {
  HIGH: "border-2 border-border-strong bg-destructive text-destructive-foreground",
  MEDIUM: "border-2 border-border-strong bg-warning text-warning-foreground",
  LOW: "bg-muted text-muted-foreground",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type InsightReport = any;

function CooInsightsPage() {
  const { t } = useT();
  const { session } = useAuth();
  const [week, setWeek] = useState(currentWeek);
  const [reports, setReports] = useState<InsightReport[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [incidentOpen, setIncidentOpen] = useState(false);

  const report = useMemo(
    () =>
      reports.find((r) => r.week_start === week.weekStart && r.week_end === week.weekEnd) ?? null,
    [reports, week],
  );

  const loadReports = async () => {
    if (!session?.access_token) return;
    const rows = await listCooInsightReports({
      data: { adminToken: session.access_token, limit: 12 },
    });
    setReports(rows);
  };

  const loadIncidents = async () => {
    if (!session?.access_token) return;
    const rows = await listIncidentReports({ data: { adminToken: session.access_token, ...week } });
    setIncidents(rows);
  };

  useEffect(() => {
    if (!session?.access_token) return;
    setLoading(true);
    Promise.all([loadReports(), loadIncidents()]).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.access_token, week.weekStart, week.weekEnd]);

  const generate = async () => {
    if (!session?.access_token) return toast.error("Sesi admin habis — login ulang");
    setGenerating(true);
    try {
      await triggerCooInsightManual({ data: { adminToken: session.access_token, ...week } });
      toast.success("Laporan Ops Insight berhasil dibuat");
      await loadReports();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const removeIncident = async (id: string) => {
    if (!session?.access_token) return;
    if (!(await confirmDialog({ title: "Hapus insiden ini?", confirmText: "Hapus" }))) return;
    try {
      await deleteIncidentReport({ data: { adminToken: session.access_token, id } });
      toast.success("Insiden dihapus");
      loadIncidents();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <AdminLayout
      title={t("coo.title")}
      subtitle={t("coo.subtitle")}
    >
      {/* Week selector */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button
          onClick={() => setWeek((w) => shiftWeek(w, -7))}
          className="p-1.5 rounded-md border border-border hover:bg-muted"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-sm font-medium">
          {week.weekStart} → {week.weekEnd}
        </span>
        <button
          onClick={() => setWeek((w) => shiftWeek(w, 7))}
          className="p-1.5 rounded-md border border-border hover:bg-muted"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        <div className="flex-1" />
        <button
          onClick={() => setIncidentOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> {t("coo.logIncident")}
        </button>
        <button
          onClick={generate}
          disabled={generating}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-sm hover:opacity-90 disabled:opacity-60 transition-opacity"
        >
          {generating ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Sparkles className="w-3.5 h-3.5" />
          )}
          {report ? t("coo.regenerate") : t("coo.generateNow")}
        </button>
      </div>

      {loading ? (
        <div className="p-10 text-center text-muted-foreground">
          <Loader2 className="w-5 h-5 inline animate-spin mr-2" />
          {t("analytics.loading")}
        </div>
      ) : (
        <div className="space-y-4">
          {/* Incident log minggu ini */}
          <div className="rounded-xl border border-border p-4">
            <h3 className="text-sm font-semibold mb-3">{t("coo.incidentsThisWeek")} ({incidents.length})</h3>
            {incidents.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("coo.noIncidents")}</p>
            ) : (
              <ul className="space-y-2">
                {incidents.map((i) => (
                  <li
                    key={i.id}
                    className="flex items-start gap-2 text-sm border-t border-border pt-2 first:border-0 first:pt-0"
                  >
                    <span
                      className={`text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${SEVERITY_STYLE[i.severity]}`}
                    >
                      {i.severity}
                    </span>
                    <span className="flex-1">
                      <span className="text-muted-foreground">[{i.type}]</span> {i.description}
                      {i.estimated_impact != null && (
                        <span className="text-muted-foreground">
                          {" "}
                          — dampak est. {formatRupiah(i.estimated_impact)}
                        </span>
                      )}
                    </span>
                    <button
                      onClick={() => removeIncident(i.id)}
                      className="p-1 text-destructive hover:bg-destructive hover:text-destructive-foreground rounded"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {!report ? (
            <div className="rounded-xl border border-dashed border-border p-8 text-center text-muted-foreground">
              {t("coo.noReport")}
            </div>
          ) : (
            <>
              {/* COO Brief */}
              <div className="rounded-xl border border-border p-4 bg-primary/5">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="w-4 h-4 text-primary" />
                  <h3 className="text-sm font-semibold">COO Brief</h3>
                  <span className="text-[11px] text-muted-foreground ml-auto">
                    via {report.generated_by}
                  </span>
                </div>
                <p className="text-base font-medium mb-2">{report.coo_analysis.headline}</p>
                <p className="text-sm text-muted-foreground mb-3">
                  {report.coo_analysis.coo_brief}
                </p>

                <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-1.5">
                  Top Concerns
                </h4>
                <ul className="space-y-1 mb-3">
                  {report.coo_analysis.top_concerns?.map(
                    (c: { concern: string; severity: Severity; reason: string }, i: number) => (
                      <li key={i} className="text-sm flex items-start gap-2">
                        <span
                          className={`text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${SEVERITY_STYLE[c.severity]}`}
                        >
                          {c.severity}
                        </span>
                        <span>
                          <b>{c.concern}</b> — {c.reason}
                        </span>
                      </li>
                    ),
                  )}
                </ul>

                <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-1.5">
                  Top Actions
                </h4>
                <ul className="space-y-1">
                  {report.coo_analysis.top_actions?.map(
                    (
                      a: {
                        rank: number;
                        action: string;
                        owner: string;
                        roi: string;
                        approve: "YES" | "NO";
                      },
                      i: number,
                    ) => (
                      <li key={i} className="text-sm flex items-start gap-2">
                        <span
                          className={`text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${a.approve === "YES" ? "border-2 border-border-strong bg-success text-success-foreground" : "bg-muted text-muted-foreground"}`}
                        >
                          {a.approve}
                        </span>
                        <span>
                          #{a.rank} <b>{a.action}</b> — {a.owner} · ROI: {a.roi}
                        </span>
                      </li>
                    ),
                  )}
                </ul>
              </div>

              {/* Manager actions */}
              <div className="rounded-xl border border-border p-4">
                <h3 className="text-sm font-semibold mb-3">{t("coo.managerActions")}</h3>
                <p className="text-sm text-muted-foreground mb-3">
                  {report.manager_analysis.manager_summary}
                </p>
                <div className="grid md:grid-cols-2 gap-4">
                  {(["quick_wins", "medium_term"] as const).map((key) => (
                    <div key={key}>
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-1.5">
                        {key === "quick_wins"
                          ? "Quick Wins (< 3 hari)"
                          : "Medium Term (2-4 minggu)"}
                      </h4>
                      <ul className="space-y-2">
                        {report.manager_analysis[key]?.map(
                          (
                            a: {
                              action: string;
                              owner: string;
                              timeline: string;
                              cost: number;
                              expected_impact: string;
                              metric: string;
                            },
                            i: number,
                          ) => (
                            <li key={i} className="text-sm border border-border rounded-lg p-2">
                              <p className="font-medium">{a.action}</p>
                              <p className="text-xs text-muted-foreground">
                                {a.owner} · {a.timeline} · Biaya {formatRupiah(a.cost)}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Dampak: {a.expected_impact} · Metrik: {a.metric}
                              </p>
                            </li>
                          ),
                        )}
                        {!report.manager_analysis[key]?.length && (
                          <p className="text-sm text-muted-foreground">—</p>
                        )}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>

              {/* Lead RCA */}
              <div className="rounded-xl border border-border p-4">
                <h3 className="text-sm font-semibold mb-3">{t("coo.leadRca")}</h3>
                <p className="text-sm text-muted-foreground mb-3">
                  {report.lead_analysis.lead_summary}
                </p>
                <div className="grid md:grid-cols-2 gap-4">
                  {(["revenue_causes", "cost_causes"] as const).map((key) => (
                    <div key={key}>
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-1.5">
                        {key === "revenue_causes"
                          ? t("coo.revenueCauses")
                          : t("coo.costCauses")}
                      </h4>
                      <ul className="space-y-1">
                        {report.lead_analysis[key]?.map(
                          (
                            c: { cause: string; confidence: string; evidence: string },
                            i: number,
                          ) => (
                            <li key={i} className="text-sm">
                              <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground mr-1">
                                {c.confidence}
                              </span>
                              {c.cause}{" "}
                              <span className="text-muted-foreground">— {c.evidence}</span>
                            </li>
                          ),
                        )}
                        {!report.lead_analysis[key]?.length && (
                          <p className="text-sm text-muted-foreground">—</p>
                        )}
                      </ul>
                    </div>
                  ))}
                </div>
                <p className="text-sm mt-3">
                  <b>Forecast:</b> {report.lead_analysis.forward_forecast}
                </p>
              </div>

              {/* Worker metrics */}
              <div className="rounded-xl border border-border p-4">
                <h3 className="text-sm font-semibold mb-3">{t("coo.weeklyMetrics")}</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
                  {(
                    [
                      ["Revenue WoW", report.worker_analysis.wow_revenue_change],
                      ["Cost WoW", report.worker_analysis.wow_cost_change],
                      ["Margin WoW", report.worker_analysis.wow_pnl_change],
                    ] as const
                  ).map(([label, v]) => (
                    <div key={label} className="rounded-lg border border-border p-3">
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p
                        className={`text-lg font-semibold flex items-center gap-1 ${v.amount < 0 ? "text-destructive" : "text-success"}`}
                      >
                        {v.amount < 0 ? (
                          <TrendingDown className="w-4 h-4" />
                        ) : (
                          <TrendingUp className="w-4 h-4" />
                        )}
                        {formatRupiah(v.amount)}
                      </p>
                      <p className="text-xs text-muted-foreground">{v.percent.toFixed(1)}%</p>
                    </div>
                  ))}
                </div>
                {report.worker_analysis.anomalies?.length > 0 && (
                  <div className="mb-2">
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-1 flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" /> Anomali
                    </h4>
                    <ul className="text-sm list-disc list-inside">
                      {report.worker_analysis.anomalies.map((a: string, i: number) => (
                        <li key={i}>{a}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="text-sm text-muted-foreground">
                  {report.worker_analysis.worker_summary}
                </p>
              </div>
            </>
          )}
        </div>
      )}

      {incidentOpen && (
        <IncidentModal
          week={week}
          onClose={() => setIncidentOpen(false)}
          onSaved={() => {
            setIncidentOpen(false);
            loadIncidents();
          }}
        />
      )}
    </AdminLayout>
  );
}

function IncidentModal({
  week,
  onClose,
  onSaved,
}: {
  week: { weekStart: string; weekEnd: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useT();
  const { session } = useAuth();
  const [type, setType] = useState<IncidentType>("operational");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<Severity>("MEDIUM");
  const [impact, setImpact] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!session?.access_token) return toast.error("Sesi admin habis — login ulang");
    if (!description.trim()) return toast.error("Deskripsi wajib diisi");
    setSaving(true);
    try {
      await addIncidentReport({
        data: {
          adminToken: session.access_token,
          weekStart: week.weekStart,
          weekEnd: week.weekEnd,
          type,
          description: description.trim(),
          severity,
          estimatedImpact: impact.trim() ? Number(impact) : null,
        },
      });
      toast.success("Insiden tercatat");
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 grid place-items-center z-50 p-4" onClick={onClose}>
      <div className="bg-card rounded-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold mb-4">
          {t("coo.logIncident")} — {week.weekStart} → {week.weekEnd}
        </h2>
        <div className="space-y-3 text-sm">
          <div>
            <label className="text-xs text-muted-foreground font-medium">{t("coo.type")}</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as IncidentType)}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="operational">Operational</option>
              <option value="financial">Financial</option>
              <option value="system">System</option>
              <option value="market">Market</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground font-medium">{t("coo.description")}</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground font-medium">Severity</label>
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value as Severity)}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="HIGH">HIGH</option>
              <option value="MEDIUM">MEDIUM</option>
              <option value="LOW">LOW</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground font-medium">
              {t("coo.estimatedImpact")}
            </label>
            <input
              value={impact}
              onChange={(e) => setImpact(e.target.value)}
              type="number"
              placeholder="0"
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded-lg border border-border hover:bg-muted transition-colors"
          >
            {t("coo.cancel")}
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="px-3 py-1.5 text-sm rounded-lg bg-primary text-primary-foreground disabled:opacity-50 hover:opacity-90 transition-opacity"
          >
            {saving ? t("coo.saving") : t("coo.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
