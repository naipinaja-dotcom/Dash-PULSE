// Inti logika "Publish" payroll run — diekstrak dari tombol Publish manual
// (admin.payroll.tsx) biar bisa dipanggil juga dari webhook Basecamp Spend
// Control (lihat api.basecamp-webhook.ts) begitu status request completed,
// bukan cuma lewat klik admin. Ambil `client` generik (browser supabase ATAU
// admin/service-role) — sama pola kayak computeInstallmentAdvance/
// isMultiClientDeductionGroupComplete di payroll-generate.ts.
//
// Granularitas publish di sini PER CLIENT dalam 1 run (payroll_details.client_id),
// BUKAN per payroll_runs.client_id — 1 run bisa punya payroll_details lintas
// beberapa client (cicilan multi-client split, atau run "Semua Client" lama),
// dan tiap client di-push ke Spend Control sebagai request terpisah yang bisa
// completed di waktu berbeda-beda.
import {
  computeInstallmentAdvance,
  isMultiClientDeductionGroupComplete,
  DEDUCTION_PRIORITY,
} from "@/lib/payroll-generate";

export interface PublishPayrollDetailsResult {
  slipCount: number;
}

// Idempoten: detail yang udah punya payslip (onConflict detail_id) dilewati,
// jadi aman dipanggil dobel (webhook retry, atau fallback manual Publish
// setelah sebagian client udah auto-published lewat webhook).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function publishPayrollDetails(
  client: any,
  opts: { runId: string; clientId: string | null; actorUserId: string | null },
): Promise<PublishPayrollDetailsResult> {
  const { runId, clientId, actorUserId } = opts;
  const { data: dets } = await client
    .from("payroll_details")
    .select("*")
    .eq("run_id", runId)
    .eq("client_id", clientId);
  if (!dets?.length) return { slipCount: 0 };

  const { data: existingSlips } = await client
    .from("payslips")
    .select("detail_id")
    .in(
      "detail_id",
      dets.map((d: any) => d.id),
    );
  const alreadyPublished = new Set((existingSlips ?? []).map((s: any) => s.detail_id));
  const remaining = dets.filter((d: any) => !alreadyPublished.has(d.id));
  if (!remaining.length) return { slipCount: 0 };

  const slips = remaining.map((d: any) => ({
    detail_id: d.id,
    run_id: runId,
    rider_id: d.rider_id,
    data: d,
  }));
  const { error: e1 } = await client.from("payslips").upsert(slips, { onConflict: "detail_id" });
  if (e1) throw new Error(e1.message);

  // Alokasi gross_earning tiap detail ke potongan-potongannya sesuai prioritas
  // (Admin > BPJS > Kerusakan Barang > Kasbon > Sewa Molis > Pinjaman Kuota) —
  // sama persis logikanya kayak publish() manual di admin.payroll.tsx.
  const grossByDetail = new Map<string, number>(
    remaining.map((d: any) => [d.id, Number(d.gross_earning)]),
  );
  const { data: deds } = await client
    .from("payroll_deductions")
    .select("id, detail_id, installment_id, amount, deduction_types(code)")
    .in(
      "detail_id",
      remaining.map((d: any) => d.id),
    );

  const byDetail = new Map<string, any[]>();
  for (const d of (deds ?? []) as any[]) {
    const arr = byDetail.get(d.detail_id) ?? [];
    arr.push(d);
    byDetail.set(d.detail_id, arr);
  }

  for (const [detailId, rows] of byDetail) {
    let remainingGross = grossByDetail.get(detailId) ?? 0;
    const sorted = [...(rows ?? [])].sort(
      (a: any, b: any) =>
        (DEDUCTION_PRIORITY[a.deduction_types?.code] ?? 99) -
        (DEDUCTION_PRIORITY[b.deduction_types?.code] ?? 99),
    );
    for (const row of sorted as any[]) {
      const amount = Number(row.amount);
      const paid = Math.max(0, Math.min(remainingGross, amount));
      remainingGross -= paid;
      await client.from("payroll_deductions").update({ paid_amount: paid }).eq("id", row.id);
      if (!row.installment_id) continue;
      const { data: ins } = await client
        .from("rider_installments")
        .select("*")
        .eq("id", row.installment_id)
        .single();
      if (!ins) continue;
      let paidInFull = paid >= amount;
      if (
        paidInFull &&
        ins.mode === "fixed" &&
        Array.isArray(ins.client_ids) &&
        ins.client_ids.length > 1
      ) {
        // Perlu period_start/period_end run-nya — ambil sekali, bukan per-row.
        const { data: runRow } = await client
          .from("payroll_runs")
          .select("period_start, period_end")
          .eq("id", runId)
          .single();
        paidInFull = await isMultiClientDeductionGroupComplete(
          client,
          ins.id,
          runRow?.period_start,
          runRow?.period_end,
          row.id,
        );
      }
      const advance = computeInstallmentAdvance(ins, paidInFull);
      if (!advance) continue;
      await client.from("rider_installments").update(advance).eq("id", ins.id);
    }
  }

  // Tandain push Spend Control (attempt terakhir) buat client+run ini sebagai
  // sudah published — buat idempotency check & visibility di UI. Gak ada push
  // row sama sekali (mis. publish manual tanpa pernah push dulu) = no-op.
  if (clientId) {
    const { data: latestPush } = await client
      .from("spend_control_pushes")
      .select("id")
      .eq("payroll_run_id", runId)
      .eq("client_id", clientId)
      .order("attempt", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestPush) {
      await client
        .from("spend_control_pushes")
        .update({ published_at: new Date().toISOString() })
        .eq("id", latestPush.id);
    }
  }

  void actorUserId; // dipakai caller buat posthog/audit, bukan di sini
  return { slipCount: remaining.length };
}

// Run baru dianggap "published" kalau SEMUA client yang punya payroll_details
// di run ini udah ke-publish (ada payslip buat tiap detail row-nya) — bukan
// cuma 1 client doang. Dipanggil setelah publishPayrollDetails() tiap client.
export async function maybeCompleteRunPublish(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  runId: string,
  actorUserId: string | null = null,
): Promise<boolean> {
  const { data: run } = await client
    .from("payroll_runs")
    .select("status")
    .eq("id", runId)
    .single();
  if (!run || run.status === "published") return false;

  const { data: dets } = await client.from("payroll_details").select("id").eq("run_id", runId);
  if (!dets?.length) return false;

  const { data: slips } = await client
    .from("payslips")
    .select("detail_id")
    .in(
      "detail_id",
      dets.map((d: any) => d.id),
    );
  const publishedIds = new Set((slips ?? []).map((s: any) => s.detail_id));
  const allDone = dets.every((d: any) => publishedIds.has(d.id));
  if (!allDone) return false;

  const { error } = await client
    .from("payroll_runs")
    .update({
      status: "published",
      published_at: new Date().toISOString(),
      published_by: actorUserId,
    })
    .eq("id", runId);
  if (error) throw new Error(error.message);
  return true;
}
