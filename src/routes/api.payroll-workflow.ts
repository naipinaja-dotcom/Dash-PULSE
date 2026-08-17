import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import type {} from "@tanstack/react-start";
import {
  runPayrollWorkflow,
  runFeeAndPayrollForPeriod,
  verifyPayrollWorkflowSecret,
} from "@/lib/payroll-workflow.server";
import { getPostHogClient } from "@/utils/posthog-server";

// Endpoint cron HARIAN buat Payroll Workflow (OES AI Workforce) — tiap client
// dicek apakah periode gajiannya (custom per client, lihat Reminder Calendar)
// jatuh tempo hari itu. Dipanggil via HTTP POST + header
// `x-payroll-workflow-secret` (harus sama persis dengan env
// PAYROLL_WORKFLOW_SECRET). Jadwalkan lewat pg_cron + pg_net di Supabase —
// lihat supabase/migrations/20260720000001_payroll_workflow_cron.sql.
export const Route = createFileRoute("/api/payroll-workflow")({
  server: {
    handlers: {
      POST: async () => {
        const request = getRequest();
        const secretHeader = request?.headers.get("x-payroll-workflow-secret") ?? null;
        if (!verifyPayrollWorkflowSecret(secretHeader)) {
          return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }
        let body: {
          trigger?: "scheduler" | "event" | "manual";
          clientId?: string;
          periodStart?: string;
          periodEnd?: string;
        } = {};
        try {
          body = await request!.json();
        } catch {
          // body kosong = default trigger "scheduler" (cron)
        }
        // Backfill/verifikasi manual untuk 1 client+periode eksplisit (di luar
        // jadwal Reminder Calendar) — dipakai buat tes fitur ini pakai data
        // periode lampau, TANPA kirim notif Slack/Email berulang.
        if (body.trigger === "manual" && body.clientId && body.periodStart && body.periodEnd) {
          try {
            const result = await runFeeAndPayrollForPeriod({
              clientId: body.clientId,
              periodStart: body.periodStart,
              periodEnd: body.periodEnd,
            });
            return new Response(JSON.stringify({ ok: true, result }), {
              headers: { "Content-Type": "application/json" },
            });
          } catch (e) {
            return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            });
          }
        }
        const triggeredBy = body.trigger === "manual" ? "manual" : body.trigger === "event" ? "event" : "cron";
        try {
          const result = await runPayrollWorkflow({ triggeredBy });
          const posthog = getPostHogClient();
          posthog.capture({
            distinctId: "system-cron",
            event: "payroll_workflow_run",
            properties: { trigger: triggeredBy, runCount: result.runs.length, skipped: result.skippedClients.length },
          });
          await posthog.flush();
          return new Response(JSON.stringify({ ok: true, runId: result.runLogId, result }), {
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
