import { callHermes } from "./hermes-client.server";
import type { WorkerAnalysis } from "./worker-agent";
import type { LeadAnalysis } from "./lead-agent";

export interface ManagerAgentInput {
  workerAnalysis: WorkerAnalysis;
  leadAnalysis: LeadAnalysis;
}

export interface ManagerAction {
  action: string;
  owner: string;
  timeline: string;
  cost: number;
  expected_impact: string;
  metric: string;
}

export interface ManagerAnalysis {
  quick_wins: ManagerAction[];
  medium_term: ManagerAction[];
  manager_summary: string;
}

const SYSTEM_PROMPT = `You are an Operations Manager at a delivery/payroll company (Dash PULSE) responsible for action planning.
Convert root-cause analysis into concrete, prioritized actions with owners.
Respond with a single valid JSON object only — no markdown fences, no extra text.`;

export async function runManagerAgent(input: ManagerAgentInput): Promise<ManagerAnalysis> {
  const userPrompt = `Lead Analysis (Root Causes):
${JSON.stringify(input.leadAnalysis, null, 2)}

Worker Analysis (Metrics):
${JSON.stringify(input.workerAnalysis, null, 2)}

For EACH root cause, propose 1-2 concrete actions with: clear action name, owner (Operations Manager, Engineering, Finance, atau lainnya), timeline, cost estimate (IDR, 0 kalau gratis), expected $ impact, success metric.
Separate quick wins (doable in under 3 days) from medium-term actions (2-4 weeks). Prioritize by impact x feasibility x speed.

Respond in this exact JSON shape:
{
  "quick_wins": [{ "action": "string", "owner": "string", "timeline": "string", "cost": number, "expected_impact": "string", "metric": "string" }],
  "medium_term": [{ "action": "string", "owner": "string", "timeline": "string", "cost": number, "expected_impact": "string", "metric": "string" }],
  "manager_summary": "string"
}`;

  const result = await callHermes({ system: SYSTEM_PROMPT, user: userPrompt, maxTokens: 2000 });
  return result as ManagerAnalysis;
}
