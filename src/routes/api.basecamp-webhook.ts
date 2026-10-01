import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import type {} from "@tanstack/react-start";
import { getServerConfig } from "@/lib/config.server";
import { getSupabaseAdmin } from "@/lib/supabase-admin.server";
import { publishPayrollDetails, maybeCompleteRunPublish } from "@/lib/payroll-publish";
import { getPostHogClient } from "@/utils/posthog-server";

// Webhook Basecamp Spend Control — begitu status 1 payment request berubah
// jadi "completed", auto-publish SLICE client itu di run-nya (lihat
// payroll-publish.ts), gak perlu tombol "Publish" manual lagi. Tombol manual
// tetap ada sebagai fallback kalau webhook ini gagal/telat.
//
// PAYLOAD BELUM DIKONFIRMASI ke kontrak asli Basecamp — ini asumsi wajar
// (requestId, status, completedAt opsional) sampai dicek ke tim Basecamp.
// Auth: header `x-basecamp-webhook-secret` harus sama persis dgn env
// BASECAMP_WEBHOOK_SECRET (sama pola dgn x-pnl-push-secret dkk).
function verifyBasecampWebhookSecret(headerValue: string | null): boolean {
  const expected = getServerConfig().basecampWebhookSecret;
  if (!expected) return false;
  return !!headerValue && headerValue === expected;
}

function normalizeStatus(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase();
}

export const Route = createFileRoute("/api/basecamp-webhook")({
  server: {
    handlers: {
      POST: async () => {
        const request = getRequest();
        const secretHeader = request?.headers.get("x-basecamp-webhook-secret") ?? null;
        if (!verifyBasecampWebhookSecret(secretHeader)) {
          return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        let body: { requestId?: string; status?: string; completedAt?: string };
        try {
          body = await request!.json();
        } catch {
          return new Response(JSON.stringify({ ok: false, error: "Invalid JSON body" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
        const requestId = body.requestId?.trim();
        if (!requestId) {
          return new Response(JSON.stringify({ ok: false, error: "requestId wajib diisi" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
        const status = normalizeStatus(body.status);

        try {
          const admin = getSupabaseAdmin();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: push, error: findErr } = await (admin as any)
            .from("spend_control_pushes")
            .select("id, payroll_run_id, client_id, attempt")
            .eq("request_id", requestId)
            .maybeSingle();
          if (findErr) throw new Error(findErr.message);
          if (!push) {
            // Basecamp mungkin retry webhook — 200 no-op biar gak dikira gagal
            // terus-terusan di-retry buat requestId yang emang gak kita kenal.
            return new Response(
              JSON.stringify({ ok: true, noop: true, reason: "requestId tidak ditemukan" }),
              { headers: { "Content-Type": "application/json" } },
            );
          }

          // Supersession guard — kalau request ini BUKAN attempt terakhir buat
          // (run, client) ini (udah ke-repush), abaikan: completion event buat
          // request LAMA gak boleh trigger publish atas nama request BARU.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: latest } = await (admin as any)
            .from("spend_control_pushes")
            .select("id, attempt")
            .eq("payroll_run_id", push.payroll_run_id)
            .eq("client_id", push.client_id)
            .order("attempt", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (latest && latest.id !== push.id) {
            return new Response(
              JSON.stringify({ ok: true, noop: true, reason: "request sudah di-supersede" }),
              { headers: { "Content-Type": "application/json" } },
            );
          }

          await (admin as any)
            .from("spend_control_pushes")
            .update({
              basecamp_status: status || "unknown",
              basecamp_completed_at:
                status === "completed" ? (body.completedAt ?? new Date().toISOString()) : null,
            })
            .eq("id", push.id);

          let published = false;
          let slipCount = 0;
          if (status === "completed") {
            const res = await publishPayrollDetails(admin, {
              runId: push.payroll_run_id,
              clientId: push.client_id,
              actorUserId: null,
            });
            slipCount = res.slipCount;
            published = await maybeCompleteRunPublish(admin, push.payroll_run_id, null);
          }

          const posthog = getPostHogClient();
          posthog.capture({
            distinctId: "system-basecamp-webhook",
            event: "payroll_run_auto_published",
            properties: {
              run_id: push.payroll_run_id,
              client_id: push.client_id,
              status,
              slip_count: slipCount,
              run_fully_published: published,
            },
          });
          await posthog.flush();

          return new Response(JSON.stringify({ ok: true, slipCount, runFullyPublished: published }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (e) {
          return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
