import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import type {} from "@tanstack/react-start";
import { runLiveFeeSync, verifyLiveFeeSyncSecret } from "@/lib/live-fee-sync.server";
import { getPostHogClient } from "@/utils/posthog-server";

// Endpoint cron buat Live Fee Auto-Sync — per client yang sudah di-link ke
// provider (clients.provider_id), tarik data live dashelectric, hitung fee,
// dan commit ke DB + Payroll Run — sama persis dengan "Sync ke Database"
// manual di admin.calculate.tsx. Dipanggil via HTTP POST + header
// `x-live-fee-sync-secret` (harus sama persis dengan env LIVE_FEE_SYNC_SECRET).
// Dua jadwal aktif (lihat supabase/migrations/):
//   - live-fee-sync-0100/0600 (20260730000001_live_fee_sync_cron.sql):
//     finalisasi data KEMARIN, {from,to} eksplisit, gak pakai gateByRunTime.
//   - live-fee-sync-15min (20260831000000_live_fee_sync_15min_cron.sql):
//     polling tiap 15 menit, gateByRunTime:true — tiap client cuma diproses
//     30 menit sebelum run_time custom-nya (lihat komentar runLiveFeeSync).
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
        let body: { from?: string; to?: string; gateByRunTime?: boolean } = {};
        try {
          body = await request!.json();
        } catch {
          // body kosong = default window rolling 8 hari (lihat defaultWindow())
        }
        try {
          const result = await runLiveFeeSync({
            triggeredBy: "cron",
            from: body.from,
            to: body.to,
            gateByRunTime: body.gateByRunTime,
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
