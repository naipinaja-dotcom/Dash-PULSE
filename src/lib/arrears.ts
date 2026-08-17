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

export type RentalUnpaid = { dedId: string; amount: number; paidAmount: number; unpaid: number };

// Tunggakan sewa molis (mode daily/monthly, open-ended, gak punya "total") — diambil
// dari baris payroll_deductions TERAKHIR yang udah dipublish buat installment itu,
// "terakhir" ditentukan dari periode payroll-nya (payroll_runs.period_end), BUKAN
// created_at baris-nya — kalau admin generate ulang/backfill periode yang kelewat
// setelah periode yang lebih baru udah publish, created_at bisa salah urutan tapi
// period_end tetap benar. Logic sama persis dengan getCarriedArrears() di
// payroll-generate.ts. Ngembalikan baris deduction persis (dedId/amount/paidAmount)
// biar bisa dikoreksi dari arrears-tab.tsx (master admin only, lihat RLS
// "pded update tunggakan gated"), bukan cuma buat dibaca/ditampilkan doang.
export async function latestRentalUnpaid(installmentIds: string[]): Promise<Map<string, RentalUnpaid>> {
  const result = new Map<string, RentalUnpaid>();
  if (installmentIds.length === 0) return result;
  const { data: deds } = await sb
    .from("payroll_deductions")
    .select("id, installment_id, amount, paid_amount, payroll_details(payroll_runs(period_end, status))")
    .in("installment_id", installmentIds)
    .not("paid_amount", "is", null);
  const latestByInstallment = new Map<string, { periodEnd: string; dedId: string; amount: number; paidAmount: number }>();
  for (const d of deds ?? []) {
    const run = d.payroll_details?.payroll_runs;
    const periodEnd: string | undefined = run?.period_end;
    // paid_amount normally exists only after Publish. Keep the status guard
    // explicit so a manually altered draft can never be shown as arrears.
    if (!d.installment_id || !periodEnd || run?.status !== "published") continue;
    const cur = latestByInstallment.get(d.installment_id);
    if (!cur || periodEnd > cur.periodEnd)
      latestByInstallment.set(d.installment_id, {
        periodEnd,
        dedId: d.id,
        amount: Number(d.amount),
        paidAmount: Number(d.paid_amount ?? 0),
      });
  }
  for (const [id, v] of latestByInstallment)
    result.set(id, {
      dedId: v.dedId,
      amount: v.amount,
      paidAmount: v.paidAmount,
      unpaid: Math.max(0, v.amount - v.paidAmount),
    });
  return result;
}
