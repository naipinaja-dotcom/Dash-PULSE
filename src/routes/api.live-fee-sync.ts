import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import type {} from "@tanstack/react-start";
import { runLiveFeeSync, verifyLiveFeeSyncSecret } from "@/lib/live-fee-sync.server";
import { getPostHogClient } from "@/utils/posthog-server";
// TEMPORARY debug import — hapus bareng blok debugRaw di bawah setelah diagnosa selesai.
import { debugFetchRawAttendance } from "@/lib/api/live-fee-attendance.functions";

// Endpoint cron 2x/hari buat Live Fee Auto-Sync — per client yang sudah
// di-link ke provider (clients.provider_id), tarik data live dashelectric,
// hitung fee, dan commit ke DB + Payroll Run — sama persis dengan "Sync ke
// Database" manual di admin.calculate.tsx. Dipanggil via HTTP POST + header
// `x-live-fee-sync-secret` (harus sama persis dengan env LIVE_FEE_SYNC_SECRET).
// Jadwalkan lewat pg_cron + pg_net di Supabase — lihat
// supabase/migrations/20260730000001_live_fee_sync_cron.sql.
export const Route = createFileRoute("/api/live-fee-sync")({
  server: {
    handlers: {
      POST: async () => {
        const request = getRequest();
        const secretHeader = request?.headers.get("x-live-fee-sync-secret") ?? null;
        if (!verifyLiveFeeSyncSecret(secretHeader)) {
          return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }
        let body: { from?: string; to?: string; debugRaw?: boolean; providerId?: number } = {};
        try {
          body = await request!.json();
        } catch {
          // body kosong = default window rolling 2 hari (lihat defaultWindow())
        }
        // TEMPORARY debug branch — hapus bareng import debugFetchRawAttendance
        // setelah diagnosa raw response API attendance selesai.
        if (body.debugRaw && body.providerId) {
          try {
            const raw = (process.env.DASH_MGMT_API_TOKEN || "").replace(/^\s*Bearer\s+/i, "").trim();
            const token = `Bearer ${raw}`;
            const from = body.from ?? "2026-07-29";
            const to = body.to ?? "2026-07-30";
            const sample = await debugFetchRawAttendance(token, body.providerId, from, to);
            return new Response(JSON.stringify({ ok: true, sample }), {
              headers: { "Content-Type": "application/json" },
            });
          } catch (e) {
            return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            });
          }
        }
        try {
          const result = await runLiveFeeSync({
            triggeredBy: "cron",
            from: body.from,
            to: body.to,
          });
          const posthog = getPostHogClient();
          posthog.capture({
            distinctId: "system-cron",
            event: "live_fee_sync_run",
            properties: {
              clientsChecked: result.clientsChecked,
              clientsSynced: result.clientsSynced,
              from: result.from,
              to: result.to,
            },
          });
          await posthog.flush();
          return new Response(JSON.stringify({ ok: true, result }), {
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
