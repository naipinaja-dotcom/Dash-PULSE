// Insentif tambahan (di luar skema) yang di-entry manual per rider lewat
// IncentiveEditor (admin.payroll.tsx) — ini duit beneran keluar, tapi
// computePnl() cuma ngitung cost dari skema rider (pricing-calc.ts), jadi
// insentif ini gak pernah ngurangin margin client sampai sekarang.
import { supabase } from "@/integrations/supabase/client";

type IncentiveDetailRow = {
  client_id: string | null;
  incentive: number | null;
  payroll_runs: { period_start: string; period_end: string; kind: string | null } | null;
};

const DAY_MS = 86_400_000;
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS) + 1;

// Insentif diprorata rata per hari periode run-nya (run 4 hari, insentif
// 40rb -> 10rb/hari), lalu cuma hari yang overlap sama [from,to] yang
// kehitung — sama logikanya kayak overlapDays di molis-cost.ts, cuma basisnya
// rate per-hari TURUNAN dari lump sum (bukan rate yang emang udah harian).
export async function fetchIncentiveCostByClient(
  from: string,
  to: string,
  client: typeof supabase = supabase,
): Promise<Map<string, number>> {
  const { data, error } = await (client as any)
    .from("payroll_details")
    .select("client_id, incentive, payroll_runs!inner(period_start, period_end, kind)")
    .gt("incentive", 0)
    .lte("payroll_runs.period_start", to)
    .gte("payroll_runs.period_end", from);
  if (error) throw error;

  const byClient = new Map<string, number>();
  for (const row of (data ?? []) as IncentiveDetailRow[]) {
    // Run EWA (payout bersih) gak pernah punya insentif (lihat payroll-
    // generate.ts: isEwa bikin incentiveTotal gak relevan), tapi jaga-jaga.
    const run = row.payroll_runs;
    if (!run || run.kind === "ewa" || !row.client_id) continue;

    const periodDays = daysBetween(run.period_start, run.period_end);
    const overlapStart = run.period_start > from ? run.period_start : from;
    const overlapEnd = run.period_end < to ? run.period_end : to;
    const overlapDays = daysBetween(overlapStart, overlapEnd);
    if (overlapDays <= 0 || periodDays <= 0) continue;

    const amount = (Number(row.incentive || 0) / periodDays) * overlapDays;
    byClient.set(row.client_id, (byClient.get(row.client_id) ?? 0) + amount);
  }
  return byClient;
}
