import process from "node:process";

// Server-only config. The .server.ts suffix prevents Vite from bundling
// this file into the client — values here never reach the browser.
//
// On Cloudflare Workers, env binds at REQUEST time. Module-scope reads
// (e.g. `const x = process.env.X`) resolve to undefined — always read
// process.env INSIDE a function or handler.
//
// When to use which env-access pattern:
//   - .server.ts module (this file): server-only helpers reused across
//     handlers. Wrap reads in a function so they run per-request.
//   - inline process.env inside a createServerFn handler: one-off reads
//     not reused elsewhere.
//   - import.meta.env.VITE_FOO: PUBLIC config readable from both client
//     and server (analytics IDs, public URLs). Define in .env with the
//     VITE_ prefix. Never put secrets here — they ship to the browser.

export function getServerConfig() {
  return {
    nodeEnv: process.env.NODE_ENV,
    // Add server-only values here, e.g.:
    //   databaseUrl: process.env.DATABASE_URL,
    //   stripeSecretKey: process.env.STRIPE_SECRET_KEY,

    // Weekly PNL Push (lihat src/routes/api.pnl-weekly-push.ts) —
    // pnlPushSecret wajib dikirim cron/manual trigger sebagai header
    // `x-pnl-push-secret` biar endpoint gak bisa dipanggil orang sembarang.
    pnlPushSecret: process.env.PNL_PUSH_SECRET,
    slackWebhookUrl: process.env.SLACK_WEBHOOK_URL,
    resendApiKey: process.env.RESEND_API_KEY,
    pnlPushEmailFrom: process.env.PNL_PUSH_EMAIL_FROM,
    pnlPushEmailTo: process.env.PNL_PUSH_EMAIL_TO,

    // Payroll Reminder (lihat src/routes/api.payroll-reminder.ts) — sama
    // polanya dengan pnlPushSecret, header `x-payroll-reminder-secret`.
    payrollReminderSecret: process.env.PAYROLL_REMINDER_SECRET,

    // Ingest API (lihat src/routes/api.ingest-deliveries.ts & api.ingest-attendance.ts) —
    // pintu intake buat agent cronjob dari backoffice eksternal POST data CSV.
    // Header `x-ingest-secret` wajib sama persis dengan env ini, biar endpoint
    // gak bisa dipanggil orang sembarang. Pakai service-role client (bypass RLS)
    // karena cron gak punya session admin.
    ingestSecret: process.env.INGEST_SECRET,

    // COO Insight Agents (lihat src/lib/coo-insight-engine.server.ts) — chain
    // Worker->Lead->Manager->COO yang analisis pnl_weekly_snapshots pakai
    // model Hermes (NousResearch) lewat OpenRouter (API OpenAI-compatible,
    // lihat src/lib/agents/hermes-client.server.ts). openRouterApiKey dari
    // openrouter.ai/keys. cooInsightSecret sama polanya dengan pnlPushSecret,
    // header `x-coo-insight-secret` buat endpoint cron api/coo-insight.
    // .trim() — copy-paste dari terminal/markdown sering nyelipin trailing
    // newline/space yang bikin OpenRouter selalu bilang "Invalid API key"
    // walau key-nya sendiri valid.
    openRouterApiKey: process.env.OPENROUTER_API_KEY?.trim(),
    hermesModel: (process.env.HERMES_MODEL || "nousresearch/hermes-3-llama-3.1-405b").trim(),
    cooInsightSecret: process.env.COO_INSIGHT_SECRET?.trim(),

    // Payroll Workflow (lihat src/lib/payroll-workflow.server.ts) — cron
    // mingguan generate+validate+audit payroll. Sama polanya dgn
    // payrollReminderSecret, header `x-payroll-workflow-secret`.
    payrollWorkflowSecret: process.env.PAYROLL_WORKFLOW_SECRET?.trim(),

    // Live Fee Auto-Sync (lihat src/lib/live-fee-sync.server.ts) — cron 2x/hari
    // tarik data live dashelectric per client yang sudah di-link provider
    // (clients.provider_id), lalu commit sama seperti "Sync ke Database"
    // manual. Sama polanya dgn payrollWorkflowSecret, header
    // `x-live-fee-sync-secret`.
    liveFeeSyncSecret: process.env.LIVE_FEE_SYNC_SECRET?.trim(),

    // Spend Control push (lihat src/lib/api/spend-control.functions.ts &
    // admin.payroll.tsx) — Basecamp's /api/spend-requests punya nol auth
    // (lihat spend-request-api-integration.md §3), jadi gak ada token di sini,
    // cuma base URL biar bisa diarahkan ke staging tanpa ubah kode.
    basecampSpendControlUrl: (process.env.BASECAMP_SPEND_CONTROL_URL || "https://basecamp.dashelectric.co").trim(),
  };
}
