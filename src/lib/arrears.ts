import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

// Sisa cicilan fixed (kasbon dll) — total belum lunas = sisa cicilan x nominal per periode.
export function fixedRemaining(
  installmentCount: number | null,
  installmentsPaid: number,
  perPeriodAmount: number | null,
): { remaining: number; total: number; amount: number } {
  const remaining = Math.max(0, (installmentCount ?? 0) - installmentsPaid);
  return { remaining, total: installmentCount ?? 0, amount: remaining * (perPeriodAmount ?? 0) };
}

// Tunggakan sewa molis (mode daily/monthly, open-ended, gak punya "total") — diambil
// dari baris payroll_deductions TERAKHIR yang udah dipublish buat installment itu,
// "terakhir" ditentukan dari periode payroll-nya (payroll_runs.period_end), BUKAN
// created_at baris-nya — kalau admin generate ulang/backfill periode yang kelewat
// setelah periode yang lebih baru udah publish, created_at bisa salah urutan tapi
// period_end tetap benar. Logic sama persis dengan getCarriedArrears() di
// payroll-generate.ts, di sini murni buat dibaca/ditampilkan, gak nulis apa-apa.
export async function latestRentalUnpaid(installmentIds: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (installmentIds.length === 0) return result;
  const { data: deds } = await sb
    .from("payroll_deductions")
    .select("installment_id, amount, paid_amount, payroll_details(payroll_runs(period_end))")
    .in("installment_id", installmentIds)
    .not("paid_amount", "is", null);
  const latestByInstallment = new Map<string, { periodEnd: string; unpaid: number }>();
  for (const d of deds ?? []) {
    const periodEnd: string | undefined = d.payroll_details?.payroll_runs?.period_end;
    if (!d.installment_id || !periodEnd) continue;
    const unpaid = Math.max(0, Number(d.amount) - Number(d.paid_amount ?? 0));
    const cur = latestByInstallment.get(d.installment_id);
    if (!cur || periodEnd > cur.periodEnd) latestByInstallment.set(d.installment_id, { periodEnd, unpaid });
  }
  for (const [id, v] of latestByInstallment) result.set(id, v.unpaid);
  return result;
}
