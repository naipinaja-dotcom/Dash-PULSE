import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import type {} from "@tanstack/react-start";
import { getServerConfig } from "@/lib/config.server";
import { getSupabaseAdmin } from "@/lib/supabase-admin.server";
import { publishByRequestId } from "@/lib/spend-control-publish.server";
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

        // TODO(sementara): hapus log ini begitu kontrak payload Basecamp udah
        // dikonfirmasi cocok sama { requestId, status, completedAt } di bawah —
        // cuma buat liat PERSIS apa yang Basecamp kirim pertama kali (cek
        // Vercel function logs buat "/api/basecamp-webhook") tanpa nebak lagi.
        const rawBody = await request!.text();
        console.log("[basecamp-webhook] raw body:", rawBody);

        let body: { requestId?: string; status?: string; completedAt?: string };
        try {
          body = JSON.parse(rawBody);
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
          const res = await publishByRequestId(admin, requestId, {
            status,
            completedAt: body.completedAt ?? null,
          });
          if (!res.matched) {
            // Basecamp mungkin retry webhook — 200 no-op biar gak dikira gagal
            // terus-terusan di-retry buat requestId yang emang gak kita kenal.
            return new Response(
              JSON.stringify({ ok: true, noop: true, reason: res.reason }),
              { headers: { "Content-Type": "application/json" } },
            );
          }
          if (res.superseded) {
            return new Response(JSON.stringify({ ok: true, noop: true, reason: res.reason }), {
              headers: { "Content-Type": "application/json" },
            });
          }

          const posthog = getPostHogClient();
          posthog.capture({
            distinctId: "system-basecamp-webhook",
            event: "payroll_run_auto_published",
            properties: {
              run_id: res.runId,
              client_id: res.clientId,
              status,
              slip_count: res.slipCount,
              run_fully_published: res.published,
            },
          });
          await posthog.flush();

          return new Response(
            JSON.stringify({ ok: true, slipCount: res.slipCount, runFullyPublished: res.published }),
            { headers: { "Content-Type": "application/json" } },
          );
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
