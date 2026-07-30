import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase-admin.server";
import { runPayrollWorkflow } from "@/lib/payroll-workflow.server";

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
