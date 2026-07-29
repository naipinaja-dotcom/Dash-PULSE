// COO Insight Agents — analisis P&L mingguan berjenjang (Worker -> Lead ->
// Manager -> COO), dipicu manual dari admin.coo-insights.tsx ATAU cron lewat
// src/routes/api.coo-insight.ts. Butuh pnl_weekly_snapshots minggu itu udah
// ada (dibuat oleh Weekly PNL Push, lihat pnl-weekly-push.server.ts) — kalau
// belum, generate akan gagal dgn pesan yang jelas, bukan nebak angka.
//
// Model: Hermes (NousResearch) lewat OpenRouter, BUKAN Claude — lihat
// src/lib/agents/hermes-client.server.ts. Sengaja dipisah dari cron
// pnl-weekly-push (endpoint api/coo-insight sendiri) biar kalau OpenRouter
// lambat/gagal, push Slack/Email PNL mingguan yang lebih kritis tetap jalan.
import { getSupabaseAdmin } from "./supabase-admin.server";
import { getServerConfig } from "./config.server";
import { runWorkerAgent } from "./agents/worker-agent";
import { runLeadAgent } from "./agents/lead-agent";
import { runManagerAgent } from "./agents/manager-agent";
import { runCooAgent, type CooAnalysis } from "./agents/coo-agent";
import { sendSlackMessage } from "./notify/slack.server";
import { sendEmail } from "./notify/email.server";

type SupabaseAdmin = ReturnType<typeof getSupabaseAdmin>;

type PnlSnapshotRow = {
  id: string;
  total_revenue: number;
  total_cost: number;
  total_margin: number;
  total_margin_pct: number;
  per_client: Array<{
    client_id: string | null;
    client: string;
    revenue: number | null;
    cost: number;
    margin: number | null;
    marginPct: number | null;
  }>;
};

function prevWeekRange(weekStart: string) {
  const end = new Date(`${weekStart}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - 6);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { weekStart: fmt(start), weekEnd: fmt(end) };
}

async function findSnapshot(
  admin: SupabaseAdmin,
  weekStart: string,
  weekEnd: string,
): Promise<PnlSnapshotRow | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any)
    .from("pnl_weekly_snapshots")
    .select("*")
    .eq("week_start", weekStart)
    .eq("week_end", weekEnd)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

const SEVERITY_EMOJI: Record<string, string> = { HIGH: "🔴", MEDIUM: "🟡", LOW: "🟢" };

// Pesan susulan Slack/Email, dikirim SETELAH Weekly PNL Push (cron terpisah,
// lihat api.coo-insight.ts) — biar kalau Hermes/OpenRouter lambat/gagal,
// pesan PNL mingguan yang lebih kritis tetap udah terkirim duluan. Ringkas
// dari cooAnalysis (brief eksekutif), bukan dump mentah worker/lead/manager.
function buildCooSlackText(weekStart: string, weekEnd: string, coo: CooAnalysis) {
  const lines = [
    `*🧭 COO Insight — ${weekStart} → ${weekEnd}*`,
    coo.headline,
    "",
    "*Top Concerns:*",
    ...coo.top_concerns.map((c) => `${SEVERITY_EMOJI[c.severity] ?? "•"} ${c.concern} — ${c.reason}`),
    "",
    "*Top Actions:*",
    ...coo.top_actions.map(
      (a) => `${a.rank}. ${a.action} (${a.owner}, ROI: ${a.roi}) — ${a.approve === "YES" ? "✅ approve" : "⏸️ hold"}`,
    ),
    "",
    coo.coo_brief,
  ];
  return lines.join("\n");
}

function buildCooEmailHtml(weekStart: string, weekEnd: string, coo: CooAnalysis) {
  const concernRows = coo.top_concerns
    .map(
      (c) =>
        `<li><b>[${c.severity}]</b> ${c.concern} — <span style="color:#666">${c.reason}</span></li>`,
    )
    .join("");
  const actionRows = coo.top_actions
    .map(
      (a) =>
        `<li>#${a.rank} ${a.action} — <i>${a.owner}</i>, ROI: ${a.roi} — ${a.approve === "YES" ? "✅ Approve" : "⏸️ Hold"}</li>`,
    )
    .join("");
  return `
  <div style="font-family:sans-serif;max-width:640px;margin:0 auto">
    <h2>🧭 COO Insight — ${weekStart} → ${weekEnd}</h2>
    <p><b>${coo.headline}</b></p>
    <h3>Top Concerns</h3>
    <ul>${concernRows}</ul>
    <h3>Top Actions</h3>
    <ul>${actionRows}</ul>
    <p>${coo.coo_brief}</p>
    <p style="color:#888;font-size:12px;margin-top:16px">Dikirim otomatis oleh Dash PULSE — COO Insight (follow-up Weekly PNL Push).</p>
  </div>`;
}

export async function generateCooInsightReport(weekStart: string, weekEnd: string) {
  const admin = getSupabaseAdmin();

  const snapshot = await findSnapshot(admin, weekStart, weekEnd);
  if (!snapshot) {
    throw new Error(
      `Belum ada PNL snapshot untuk ${weekStart} – ${weekEnd}. Jalankan Weekly PNL Push dulu.`,
    );
  }

  const prevRange = prevWeekRange(weekStart);
  const prevSnapshot = await findSnapshot(admin, prevRange.weekStart, prevRange.weekEnd);

  // Rata-rata 4 minggu terakhir (termasuk minggu ini) jadi baseline "normal".
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: recentSnapshots, error: recentErr } = await (admin as any)
    .from("pnl_weekly_snapshots")
    .select("total_revenue, total_cost")
    .lte("week_start", weekStart)
    .order("week_start", { ascending: false })
    .limit(4);
  if (recentErr) throw new Error(recentErr.message);
  const average4week = recentSnapshots?.length
    ? {
        total_revenue:
          recentSnapshots.reduce(
            (s: number, r: { total_revenue: number }) => s + Number(r.total_revenue),
            0,
          ) / recentSnapshots.length,
        total_cost:
          recentSnapshots.reduce(
            (s: number, r: { total_cost: number }) => s + Number(r.total_cost),
            0,
          ) / recentSnapshots.length,
      }
    : null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: incidentRows, error: incErr } = await (admin as any)
    .from("coo_incident_reports")
    .select("*")
    .gte("week_start", weekStart)
    .lte("week_end", weekEnd);
  if (incErr) throw new Error(incErr.message);
  const incidents = (incidentRows ?? []) as Array<{
    type: string;
    description: string;
    estimated_impact: number | null;
  }>;

  const workerAnalysis = await runWorkerAgent({
    current: {
      total_revenue: Number(snapshot.total_revenue),
      total_cost: Number(snapshot.total_cost),
      total_margin: Number(snapshot.total_margin),
      total_margin_pct: Number(snapshot.total_margin_pct),
      per_client: snapshot.per_client,
    },
    previous: prevSnapshot
      ? {
          total_revenue: Number(prevSnapshot.total_revenue),
          total_cost: Number(prevSnapshot.total_cost),
          total_margin: Number(prevSnapshot.total_margin),
        }
      : null,
    average4week,
    incidents: incidents.map((i) => ({
      type: i.type,
      description: i.description,
      estimated_impact: i.estimated_impact,
    })),
  });

  const leadAnalysis = await runLeadAgent({
    workerAnalysis,
    incidents: incidents.map((i) => ({ type: i.type, description: i.description })),
  });

  const managerAnalysis = await runManagerAgent({ workerAnalysis, leadAnalysis });

  const cooAnalysis = await runCooAgent({
    managerAnalysis,
    leadAnalysis,
    pnlContext: {
      revenue: Number(snapshot.total_revenue),
      costs: Number(snapshot.total_cost),
      margin: Number(snapshot.total_margin),
    },
  });

  // Pesan susulan ke Slack/Email — dikirim di sini (SETELAH semua analisis
  // Hermes selesai), bukan digabung ke handler pnl-weekly-push, biar
  // pemisahan reliability yang udah didesain (lihat komentar atas file) tetap
  // kejaga: kalau Hermes lambat/gagal, ini cuma bikin pesan susulan telat/gak
  // kekirim — pesan PNL mingguan yang lebih kritis udah lebih dulu jalan.
  const slackResult = await sendSlackMessage(buildCooSlackText(weekStart, weekEnd, cooAnalysis));
  const emailResult = await sendEmail({
    subject: `COO Insight — ${weekStart} → ${weekEnd}`,
    html: buildCooEmailHtml(weekStart, weekEnd, cooAnalysis),
  });
  const pushStatus = { slack: slackResult, email: emailResult };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: saved, error: insErr } = await (admin as any)
    .from("coo_insight_reports")
    .upsert(
      {
        week_start: weekStart,
        week_end: weekEnd,
        pnl_snapshot_id: snapshot.id,
        worker_analysis: workerAnalysis,
        lead_analysis: leadAnalysis,
        manager_analysis: managerAnalysis,
        coo_analysis: cooAnalysis,
        push_status: pushStatus,
        generated_by: getServerConfig().hermesModel,
        generated_at: new Date().toISOString(),
      },
      { onConflict: "pnl_snapshot_id" },
    )
    .select("id")
    .single();
  if (insErr) throw new Error(`Gagal simpan insight report: ${insErr.message}`);

  return {
    id: saved.id,
    weekStart,
    weekEnd,
    workerAnalysis,
    leadAnalysis,
    managerAnalysis,
    cooAnalysis,
    pushStatus,
  };
}

export function verifyCooInsightSecret(headerValue: string | null): boolean {
  const expected = getServerConfig().cooInsightSecret;
  if (!expected) return false;
  return !!headerValue && headerValue === expected;
}
