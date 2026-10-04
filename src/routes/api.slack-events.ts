import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import type {} from "@tanstack/react-start";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getServerConfig } from "@/lib/config.server";
import { getSupabaseAdmin } from "@/lib/supabase-admin.server";
import { publishByRequestId } from "@/lib/spend-control-publish.server";
import { getPostHogClient } from "@/utils/posthog-server";

// Slack Events API — alternatif sumber status Spend Control. App Spend Control
// posting ke channel Slack ("Request Paid" dll); endpoint ini baca event pesan
// itu, ambil id request dari link "View Request"
// (https://basecamp.dashelectric.co/spend-control/<id>), lalu auto-publish run
// yang bersangkutan (lihat spend-control-publish.server.ts). Hanya "Request
// Paid" yang memicu publish ("Approved" belum tentu cair).
//
// Auth: verifikasi HMAC Slack (x-slack-signature + x-slack-request-timestamp)
// pakai SLACK_SIGNING_SECRET. Tanpa secret, semua ditolak.
function verifySlackSignature(
  rawBody: string,
  signature: string | null,
  ts: string | null,
): boolean {
  const secret = getServerConfig().slackSigningSecret;
  if (!secret || !signature || !ts) return false;
  // Tolak request lama (replay) — lebih dari 5 menit.
  const age = Math.abs(Date.now() / 1000 - Number(ts));
  if (!Number.isFinite(age) || age > 300) return false;
  const base = `v0:${ts}:${rawBody}`;
  const expected = "v0=" + createHmac("sha256", secret).update(base).digest("hex");
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/slack-events")({
  server: {
    handlers: {
      POST: async () => {
        const request = getRequest();
        const rawBody = await request!.text();
        const sig = request?.headers.get("x-slack-signature") ?? null;
        const ts = request?.headers.get("x-slack-request-timestamp") ?? null;

        if (!verifySlackSignature(rawBody, sig, ts)) {
          return json({ ok: false, error: "Unauthorized" }, 401);
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let body: any;
        try {
          body = JSON.parse(rawBody);
        } catch {
          return json({ ok: false, error: "Invalid JSON" }, 400);
        }

        // Handshake saat daftarin Request URL di Slack.
        if (body.type === "url_verification") {
          return json({ challenge: body.challenge });
        }

        // TODO(sementara): hapus log ini begitu struktur pesan Slack
        // terkonfirmasi — buat lihat payload pertama di Vercel logs.
        console.log("[slack-events] raw body:", rawBody);

        if (body.type !== "event_callback" || body?.event?.type !== "message") {
          return json({ ok: true, noop: true });
        }

        // Cuma "Request Paid" (uang beneran keluar) yang memicu publish.
        // "Request Approved"/status lain diabaikan.
        if (!/Request Paid/i.test(rawBody)) {
          return json({ ok: true, noop: true, reason: "bukan Request Paid" });
        }

        // Ambil id request dari link View Request. JSON Slack bisa meng-escape
        // "/" jadi "\/", jadi buang backslash dulu sebelum regex.
        const unescaped = rawBody.replace(/\\\//g, "/");
        const m = unescaped.match(/spend-control\/([A-Za-z0-9]+)/);
        if (!m) {
          return json({ ok: true, noop: true, reason: "link request tidak ketemu" });
        }
        const requestId = m[1];

        try {
          const admin = getSupabaseAdmin();
          const res = await publishByRequestId(admin, requestId, { status: "paid" });

          const posthog = getPostHogClient();
          posthog.capture({
            distinctId: "system-slack-spend-control",
            event: "payroll_run_auto_published",
            properties: {
              source: "slack",
              request_id: requestId,
              run_id: res.runId,
              client_id: res.clientId,
              matched: res.matched,
              superseded: res.superseded,
              slip_count: res.slipCount,
              run_fully_published: res.published,
            },
          });
          await posthog.flush();

          // Selalu 200 biar Slack gak retry terus.
          return json({ ok: true, ...res });
        } catch (e) {
          // 200 juga buat error internal — kalau 500, Slack retry 3x; publish
          // idempoten jadi aman, tapi error dicatat buat ditelusuri.
          console.error("[slack-events] error:", (e as Error).message);
          return json({ ok: false, error: (e as Error).message });
        }
      },
    },
  },
});
