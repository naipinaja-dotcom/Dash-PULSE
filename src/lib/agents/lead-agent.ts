import { callHermes } from "./hermes-client.server";
import type { WorkerAnalysis } from "./worker-agent";

export interface LeadAgentInput {
  workerAnalysis: WorkerAnalysis;
  incidents: Array<{ type: string; description: string }>;
}

export interface LeadAnalysis {
  revenue_causes: Array<{ cause: string; confidence: "HIGH" | "MEDIUM" | "LOW"; evidence: string }>;
  cost_causes: Array<{ cause: string; confidence: "HIGH" | "MEDIUM" | "LOW"; evidence: string }>;
  forward_forecast: string;
  lead_summary: string;
}

const SYSTEM_PROMPT = `You are an Operations Analyst specializing in root cause analysis for a delivery/payroll company (Dash PULSE).
Determine WHY numbers changed, not just what changed.
Respond with a single valid JSON object only — no markdown fences, no extra text.`;

export async function runLeadAgent(input: LeadAgentInput): Promise<LeadAnalysis> {
  const userPrompt = `Worker Analysis:
${JSON.stringify(input.workerAnalysis, null, 2)}

Incidents This Week:
${JSON.stringify(input.incidents, null, 2)}

For revenue and cost changes:
1. Hypothesize 2-3 root causes each, with a confidence level and supporting evidence
2. Predict forward: if the trend continues, what's the impact by end of month?

Respond in this exact JSON shape:
{
  "revenue_causes": [{ "cause": "string", "confidence": "HIGH|MEDIUM|LOW", "evidence": "string" }],
  "cost_causes": [{ "cause": "string", "confidence": "HIGH|MEDIUM|LOW", "evidence": "string" }],
  "forward_forecast": "string",
  "lead_summary": "string"
}`;

  const result = await callHermes({ system: SYSTEM_PROMPT, user: userPrompt, maxTokens: 1500 });
  return result as LeadAnalysis;
}
