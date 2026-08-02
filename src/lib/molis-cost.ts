// Biaya sewa molis yang charge_target='client_revenue' (rider gratis, kita
// yang nanggung sewanya) — ini gak pernah nyentuh payroll rider (lihat
// payroll-generate.ts), tapi tetap harus ngurangin margin client di P&L.
import { supabase } from "@/integrations/supabase/client";

type DailyMolisRow = {
  daily_rate: number | null;
  start_date: string;
  riders: { client_id: string | null } | null;
};

// Jumlah hari overlap antara [start_date, sekarang/open-ended] dan [from, to].
function overlapDays(startDate: string, from: string, to: string): number {
  const s = startDate > from ? startDate : from;
  if (s > to) return 0;
  const sDate = new Date(`${s}T00:00:00Z`);
  const eDate = new Date(`${to}T00:00:00Z`);
  return Math.round((eDate.getTime() - sDate.getTime()) / 86_400_000) + 1;
}

export async function fetchMolisRevenueCost(
  from: string,
  to: string,
  client: typeof supabase = supabase,
): Promise<Map<string, number>> {
  const { data, error } = await (client as any)
    .from("rider_installments")
    .select("daily_rate, start_date, riders(client_id)")
    .eq("active", true)
    .eq("mode", "daily")
    .eq("charge_target", "client_revenue")
    .lte("start_date", to);
  if (error) throw error;

  const byClient = new Map<string, number>();
  for (const row of (data ?? []) as DailyMolisRow[]) {
    const clientId = row.riders?.client_id;
    if (!clientId) continue;
    const days = overlapDays(row.start_date, from, to);
    if (days <= 0) continue;
    const amount = Number(row.daily_rate || 0) * days;
    byClient.set(clientId, (byClient.get(clientId) ?? 0) + amount);
  }
  return byClient;
}
