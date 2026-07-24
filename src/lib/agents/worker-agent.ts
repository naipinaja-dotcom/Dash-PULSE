import { callHermes } from "./hermes-client.server";

type PerClientLite = {
  client_id: string | null;
  client: string;
  revenue: number | null;
  cost: number;
  margin: number | null;
  marginPct: number | null;
};

export interface WorkerAgentInput {
  current: {
    total_revenue: number;
    total_cost: number;
    total_margin: number;
    total_margin_pct: number;
    per_client: PerClientLite[];
  };
  previous: { total_revenue: number; total_cost: number; total_margin: number } | null;
  average4week: { total_revenue: number; total_cost: number } | null;
  incidents: Array<{ type: string; description: string; estimated_impact: number | null }>;
}

export interface WorkerAnalysis {
  wow_revenue_change: { amount: number; percent: number };
  wow_cost_change: { amount: number; percent: number };
  wow_pnl_change: { amount: number; percent: number };
  vs_average: { revenue_deviation_pct: number; cost_deviation_pct: number };
  anomalies: string[];
  correlations: string[];
  worker_summary: string;
}

const SYSTEM_PROMPT = `You are a Financial Data Analyst for a delivery/payroll company (Dash PULSE).
Your job is to analyze weekly P&L data and identify numerical changes.
Respond with a single valid JSON object only — no markdown fences, no extra text.`;

export async function runWorkerAgent(input: WorkerAgentInput): Promise<WorkerAnalysis> {
  const { current, previous, average4week, incidents } = input;

  const userPrompt = `Current Week P&L:
- Revenue: ${current.total_revenue}
- Total Cost: ${current.total_cost}
- Margin: ${current.total_margin} (${current.total_margin_pct.toFixed(1)}%)
- Per Client: ${JSON.stringify(current.per_client)}

Previous Week:
${previous ? `- Revenue: ${previous.total_revenue}\n- Total Cost: ${previous.total_cost}\n- Margin: ${previous.total_margin}` : "(tidak ada snapshot minggu sebelumnya)"}

4-Week Average:
${average4week ? `- Revenue: ${average4week.total_revenue}\n- Total Cost: ${average4week.total_cost}` : "(belum cukup histori snapshot)"}

Incidents This Week:
${JSON.stringify(incidents)}

Analyze this data and provide:
1. Week-over-week changes ($ and %) for revenue, cost, and margin
2. Deviation vs 4-week average (%)
3. Key anomalies and correlations between incidents and the numbers
4. Summary for the next agent (root-cause analyst)

If previous week or 4-week average isn't available, use 0 for the numeric comparison fields and say so in worker_summary — do not invent numbers.

Respond in this exact JSON shape:
{
  "wow_revenue_change": { "amount": number, "percent": number },
  "wow_cost_change": { "amount": number, "percent": number },
  "wow_pnl_change": { "amount": number, "percent": number },
  "vs_average": { "revenue_deviation_pct": number, "cost_deviation_pct": number },
  "anomalies": ["string"],
  "correlations": ["string"],
  "worker_summary": "string"
}`;

  const result = await callHermes({ system: SYSTEM_PROMPT, user: userPrompt, maxTokens: 1500 });
  return result as WorkerAnalysis;
}
