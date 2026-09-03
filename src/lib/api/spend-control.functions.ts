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
      payrollRunId: z.string().min(1),
      department: z.string().min(1),
      attachmentUrl: z.string().url(),
      // Client yang sudah pernah sukses hanya boleh dikirim lagi setelah UI
      // meminta konfirmasi eksplisit. Validasi ini tetap dilakukan server-side
      // supaya request langsung tidak bisa melewati pengaman UI.
      confirmedRepushClientIds: z.array(z.string().min(1)).default([]),
      rows: z.array(RowSchema).min(1),
    }),
  )
  .handler(async ({ data }) => {
    const admin = await requireAdmin(data.adminToken);
    const requesterEmail = admin.email ?? "";
    if (!requesterEmail) throw new Error("Akun admin tidak punya email — Spend Control butuh requesterEmail");
    const requester = (admin.user_metadata as { full_name?: string } | null)?.full_name ?? requesterEmail;
    const base = getServerConfig().basecampSpendControlUrl;
    const attachmentUrl = data.attachmentUrl;
    const supabaseAdmin = getSupabaseAdmin();

    const clientIds = [...new Set(data.rows.map((row) => row.clientId))];
    const { data: priorPushes, error: priorPushesError } = await supabaseAdmin
      .from("spend_control_pushes")
      .select("client_id, request_id, attempt")
      .eq("payroll_run_id", data.payrollRunId)
      .in("client_id", clientIds)
      .order("attempt", { ascending: false });
    if (priorPushesError) throw new Error(`Gagal cek riwayat Spend Control: ${priorPushesError.message}`);

    // Karena hasilnya diurutkan attempt desc, entri pertama setiap client adalah
    // pengajuan terakhir yang akan digantikan oleh re-push berikutnya.
    const latestPushByClient = new Map<string, { request_id: string; attempt: number }>();
    for (const push of priorPushes ?? []) {
      if (!latestPushByClient.has(push.client_id)) latestPushByClient.set(push.client_id, push);
    }
    const confirmedRepushes = new Set(data.confirmedRepushClientIds);
    const unconfirmedRepush = clientIds.find(
      (clientId) => latestPushByClient.has(clientId) && !confirmedRepushes.has(clientId),
    );
    if (unconfirmedRepush) {
      throw new Error("Konfirmasi kirim ulang diperlukan untuk pengajuan Spend Control yang sudah pernah terkirim");
    }

    const results: RowResult[] = [];
    for (const row of data.rows) {
      try {
        const previous = latestPushByClient.get(row.clientId);
        const attempt = (previous?.attempt ?? 0) + 1;
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
            externalReference: {
              ...row.externalReference,
              spendControlAttempt: attempt,
              supersedesRequestId: previous?.request_id ?? null,
            },
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
        // Simpan setiap attempt, bukan upsert: re-push membuat request baru dan
        // request lama harus tetap bisa diaudit/di-hold di Spend Control.
        const { error: pushHistoryError } = await supabaseAdmin.from("spend_control_pushes").insert(
          {
            payroll_run_id: data.payrollRunId,
            client_id: row.clientId,
            request_id: body.id,
            request_code: body.requestCode ?? null,
            amount: Math.round(row.amount),
            department: data.department,
            workflow_configured: body.workflowConfigured !== false,
            workflow_missing_reason: body.workflowMissingReason ?? null,
            pushed_by: admin.id,
            attempt,
            is_repush: !!previous,
            supersedes_request_id: previous?.request_id ?? null,
          },
        );
        if (pushHistoryError) throw new Error(`Payment request sudah dibuat, tetapi histori push gagal disimpan: ${pushHistoryError.message}`);
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
