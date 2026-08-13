import { z } from "zod";
import { callHermes } from "./hermes-client.server";
import type { ManagerAnalysis } from "./manager-agent";
import type { LeadAnalysis } from "./lead-agent";

export interface CooAgentInput {
  managerAnalysis: ManagerAnalysis;
  leadAnalysis: LeadAnalysis;
  pnlContext: { revenue: number; costs: number; margin: number };
}

// Hermes dipaksa response_format json_object (lihat hermes-client.server.ts),
// tapi itu cuma jamin JSON VALID — bukan jamin bentuknya sesuai (mis.
// top_concerns kebetulan bukan array). callHermes balikin `unknown`; dulu di
// sini langsung di-cast `as CooAnalysis` tanpa dicek, jadi baru crash belakangan
// pas dirender/dikirim, dengan pesan error yang gak jelas asalnya dari mana.
export const CooAnalysisSchema = z.object({
  headline: z.string(),
  top_concerns: z.array(
    z.object({ concern: z.string(), severity: z.enum(["HIGH", "MEDIUM", "LOW"]), reason: z.string() }),
  ),
  top_actions: z.array(
    z.object({
      rank: z.number(),
      action: z.string(),
      owner: z.string(),
      roi: z.string(),
      approve: z.enum(["YES", "NO"]),
    }),
  ),
  coo_brief: z.string(),
});

export type CooAnalysis = z.infer<typeof CooAnalysisSchema>;

const SYSTEM_PROMPT = `You are the Chief Operating Officer advisor for a delivery/payroll company (Dash PULSE).
Create a 1-page executive brief with strategic implications. Be concise and decisive — highlight only what the COO needs to know.
Respond with a single valid JSON object only — no markdown fences, no extra text.`;

export async function runCooAgent(input: CooAgentInput): Promise<CooAnalysis> {
  const userPrompt = `Manager Recommendations:
${JSON.stringify(input.managerAnalysis, null, 2)}

Lead RCA:
${JSON.stringify(input.leadAnalysis, null, 2)}

P&L Context (Current Week):
- Revenue: ${input.pnlContext.revenue}
- Costs: ${input.pnlContext.costs}
- Margin: ${input.pnlContext.margin}

Create a 1-page COO brief:
1. Headline summarizing the week in one sentence
2. Top 3 concerns with severity
3. Top 3 recommended actions with expected ROI and a YES/NO approval recommendation
4. A short executive narrative (coo_brief)

Respond in this exact JSON shape:
{
  "headline": "string",
  "top_concerns": [{ "concern": "string", "severity": "HIGH|MEDIUM|LOW", "reason": "string" }],
  "top_actions": [{ "rank": number, "action": "string", "owner": "string", "roi": "string", "approve": "YES|NO" }],
  "coo_brief": "string"
}`;

  const result = await callHermes({ system: SYSTEM_PROMPT, user: userPrompt, maxTokens: 1500 });
  const parsed = CooAnalysisSchema.safeParse(result);
  if (!parsed.success) {
    throw new Error(`Respons COO agent gak sesuai bentuk yang diharapkan: ${parsed.error.message}`);
  }
  return parsed.data;
}
