import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase-admin.server";
import {
  runPayrollWorkflow,
  autoComputeFee,
  type FeeAutoComputeResult,
} from "@/lib/payroll-workflow.server";
import { normalize } from "@/lib/pricing-store";
import type { PricingScheme } from "@/lib/pricing-types";

// Jalankan Payroll Workflow secara MANUAL dari UI (tombol "Run Workflow Sekarang")
// tanpa nunggu cron. Sama persis dengan yang dijalankan cron: tiap client
// BERJADWAL yang periodenya jatuh tempo → tarik data live API (kalau ter-map) →
// hitung fee → buat/isi Payroll Run. Cuma admin yang boleh.
async function requireAdmin(adminToken: string): Promise<string> {
  const admin = getSupabaseAdmin();
  const { data: userRes, error } = await admin.auth.getUser(adminToken);
  if (error || !userRes.user) throw new Error(`Sesi admin tidak valid: ${error?.message ?? "no user"}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: roles } = await (admin as any)
    .from("user_roles")
    .select("role")
    .eq("user_id", userRes.user.id);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!(roles ?? []).some((r: any) => r.role === "admin"))
    throw new Error("Hanya admin yang bisa menjalankan workflow");
  return userRes.user.id;
}

export const triggerPayrollWorkflow = createServerFn({ method: "POST" })
  .inputValidator(z.object({ adminToken: z.string().min(1) }))
  .handler(async ({ data }): Promise<{ runsProcessed: number; skipped: number }> => {
    const userId = await requireAdmin(data.adminToken);
    const result = await runPayrollWorkflow({ triggeredBy: "manual", triggeredByUserId: userId });
    return { runsProcessed: result.runs.length, skipped: result.skippedClients.length };
  });

// Jalankan langkah "Hitung Fee" (autoComputeFee, sama persis yang dipakai cron
// & runFeeAndPayrollForPeriod) untuk 1 client+periode, dipanggil tombol
// "Generate" di Payroll Run SEBELUM generatePayrollDetails — nutup celah lama:
// Generate cuma MENJUMLAHKAN fee yang udah tersimpan, jadi order yang fee-nya
// masih 0 (belum pernah di-Hitung-Fee) ikut jadi gaji Rp 0 (GORECA 15-21 Okt
// 2026, semua rider Rp 0; 8-14 Okt, order 13-14 Okt kurang Rp 643.500).
// Beda dari runFeeAndPayrollForPeriod: TIDAK ngecek run.status (generate manual
// dipakai juga buat "Generate Ulang" run yang udah finalized/published, bukan
// cuma draft baru) — guard overwrite non-draft itu tetap tanggung jawab
// confirmDialog di UI (admin.payroll.tsx), bukan di sini.
export const computeFeeForPeriod = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      adminToken: z.string().min(1),
      clientId: z.string().min(1),
      periodStart: z.string(),
      periodEnd: z.string(),
    }),
  )
  .handler(async ({ data }): Promise<FeeAutoComputeResult> => {
    await requireAdmin(data.adminToken);
    const admin = getSupabaseAdmin();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: schemesRaw, error } = await (admin as any)
      .from("pricing_schemes")
      .select(
        "id, name, client_id, scheme_for, calc_type, effective_from, effective_to, params, created_at",
      );
    if (error) throw new Error(`Gagal ambil skema harga: ${error.message}`);
    const schemes: PricingScheme[] = ((schemesRaw ?? []) as unknown[]).map(normalize);
    return autoComputeFee(admin, schemes, data.clientId, data.periodStart, data.periodEnd);
  });
