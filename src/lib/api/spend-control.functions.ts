import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase-admin.server";
import { getServerConfig } from "@/lib/config.server";

// Sama seperti requireAdmin di pnl-push.functions.ts — dicek ulang di sini
// (bukan di-share) supaya file ini tetap bisa dibaca berdiri sendiri.
async function requireAdmin(adminToken: string) {
  const supabaseAdmin = getSupabaseAdmin();
  const { data: userRes, error: userErr } = await supabaseAdmin.auth.getUser(adminToken);
  if (userErr || !userRes.user) throw new Error(`Sesi admin tidak valid: ${userErr?.message ?? "no user"}`);
  const { data: roles } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", userRes.user.id);
  if (!roles?.some((r) => r.role === "admin")) throw new Error("Hanya admin yang bisa lakukan ini");
  return userRes.user;
}

const RowSchema = z.object({
  clientId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  amount: z.number().positive(),
  businessUnit: z.enum(["EXPRESS", "XDOCK", "SCHEDULED", "OVERHEAD", "OTHER"]).nullable(),
  contract: z.enum(["PT_DEI", "PT_DPI"]).nullable(),
  externalReference: z.record(z.any()),
});

type RowResult = {
  clientId: string;
  ok: boolean;
  id?: string;
  requestCode?: string;
  workflowConfigured?: boolean;
  workflowMissingReason?: string;
  error?: string;
};

// Push satu payment-request per client ke Basecamp Spend Control (lihat
// spend-request-api-integration.md). Endpoint Basecamp sendiri gak ada auth
// (§3), jadi requireAdmin di sini adalah satu-satunya gerbang — tanpa itu
// siapa saja yang bisa manggil server fn ini bisa bikin spend request atas
// nama siapapun.
export const pushSpendControlRequests = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      adminToken: z.string().min(1),
      department: z.string().min(1),
      rows: z.array(RowSchema).min(1),
    }),
  )
  .handler(async ({ data }) => {
    const admin = await requireAdmin(data.adminToken);
    const requesterEmail = admin.email ?? "";
    if (!requesterEmail) throw new Error("Akun admin tidak punya email — Spend Control butuh requesterEmail");
    const requester = (admin.user_metadata as { full_name?: string } | null)?.full_name ?? requesterEmail;
    const base = getServerConfig().basecampSpendControlUrl;
    const attachmentUrl = "https://dash-payroll-engine.vercel.app/admin/payroll";

    const results: RowResult[] = [];
    for (const row of data.rows) {
      try {
        const res = await fetch(`${base}/api/spend-requests`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "payment-request",
            title: row.title,
            amount: Math.round(row.amount),
            description: row.description,
            department: data.department,
            businessUnit: row.businessUnit,
            contract: row.contract,
            requester,
            requesterEmail,
            externalReference: row.externalReference,
          }),
        });
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          results.push({ clientId: row.clientId, ok: false, error: body?.error ?? `HTTP ${res.status}` });
          continue;
        }
        // Best-effort: lampirkan link admin payroll sebagai bukti pendukung.
        // Gagal di sini gak menggagalkan request-nya sendiri (sudah terbuat).
        if (body.id) {
          await fetch(`${base}/api/spend-requests/${body.id}/attachments`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "Dash PULSE — Payroll Run", linkUrl: attachmentUrl, user: requester, userEmail: requesterEmail }),
          }).catch(() => {});
        }
        results.push({
          clientId: row.clientId,
          ok: true,
          id: body.id,
          requestCode: body.requestCode,
          workflowConfigured: body.workflowConfigured,
          workflowMissingReason: body.workflowMissingReason,
        });
      } catch (e) {
        results.push({ clientId: row.clientId, ok: false, error: (e as Error).message });
      }
    }
    return { results };
  });
