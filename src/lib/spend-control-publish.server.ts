import { getSupabaseAdmin } from "@/lib/supabase-admin.server";
import { publishPayrollDetails, maybeCompleteRunPublish } from "@/lib/payroll-publish";

type Admin = ReturnType<typeof getSupabaseAdmin>;

export interface PublishByRequestResult {
  matched: boolean;
  superseded: boolean;
  published: boolean; // run jadi fully published
  slipCount: number;
  runId?: string;
  clientId?: string | null;
  reason?: string;
}

// Inti auto-publish dari status Spend Control, dipakai bareng oleh webhook
// Basecamp langsung (api.basecamp-webhook.ts) DAN jalur Slack
// (api.slack-events.ts). requestId dicocokkan case-INSENSITIVE: link Spend
// Control di Slack me-lowercase id-nya (mis. "hoyvnmrvvssen9cnlby4") padahal
// yang tersimpan campur huruf ("hOYVnMRvvSSen9cnlBY4").
export async function publishByRequestId(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: Admin | any,
  requestId: string,
  opts: { status: string; completedAt?: string | null },
): Promise<PublishByRequestResult> {
  const status = String(opts.status ?? "")
    .trim()
    .toLowerCase();

  const { data: push, error: findErr } = await admin
    .from("spend_control_pushes")
    .select("id, payroll_run_id, client_id, attempt")
    .ilike("request_id", requestId)
    .maybeSingle();
  if (findErr) throw new Error(findErr.message);
  if (!push)
    return {
      matched: false,
      superseded: false,
      published: false,
      slipCount: 0,
      reason: "requestId tidak dikenal",
    };

  // Supersession guard — abaikan event buat request yang sudah di-repush
  // (bukan attempt terakhir buat run+client ini).
  const { data: latest } = await admin
    .from("spend_control_pushes")
    .select("id, attempt")
    .eq("payroll_run_id", push.payroll_run_id)
    .eq("client_id", push.client_id)
    .order("attempt", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latest && latest.id !== push.id) {
    return {
      matched: true,
      superseded: true,
      published: false,
      slipCount: 0,
      runId: push.payroll_run_id,
      clientId: push.client_id,
      reason: "request sudah di-supersede",
    };
  }

  // "paid" (label Slack) & "completed" (webhook) sama-sama berarti uang keluar.
  const isCompleted = status === "completed" || status === "paid";
  await admin
    .from("spend_control_pushes")
    .update({
      basecamp_status: status || "unknown",
      basecamp_completed_at: isCompleted ? (opts.completedAt ?? new Date().toISOString()) : null,
    })
    .eq("id", push.id);

  let published = false;
  let slipCount = 0;
  if (isCompleted) {
    const res = await publishPayrollDetails(admin, {
      runId: push.payroll_run_id,
      clientId: push.client_id,
      actorUserId: null,
    });
    slipCount = res.slipCount;
    published = await maybeCompleteRunPublish(admin, push.payroll_run_id, null);
  }

  return {
    matched: true,
    superseded: false,
    published,
    slipCount,
    runId: push.payroll_run_id,
    clientId: push.client_id,
  };
}
