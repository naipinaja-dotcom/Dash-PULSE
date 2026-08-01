// Aggregate delivery_records/attendance_logs (fee yang udah di-commit dari
// Hitung Fee) jadi payroll_details per rider, buat 1 payroll_runs row.
// Dipakai di 2 tempat: tombol "Generate Ulang" manual di Payroll Run, DAN
// otomatis dipanggil begitu commit() di Hitung Fee sukses — biar run-nya udah
// siap direview begitu balik ke Payroll Run, tanpa langkah manual tambahan.
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetch-all";
import { resolveRiderIdentities } from "@/lib/rider-lookup";

export interface PayrollRunLite {
  id: string;
  client_id: string | null;
  period_start: string;
  period_end: string;
  status?: string;
}

// `client` opsional: default-nya client browser (anon) yang dipakai selama ini
// dari Hitung Fee/Payroll Run. Cron/workflow server-only (gak ada session admin)
// wajib kirim getSupabaseAdmin() di sini — lihat payroll-workflow.server.ts.
export async function generatePayrollDetails(
  run: PayrollRunLite,
  client: typeof supabase = supabase,
): Promise<{ detailCount: number }> {
  await client.from("payroll_details").delete().eq("run_id", run.id);

  const [deliveries, attendance] = await Promise.all([
    fetchAllRows<{ rider_id: string | null; driver_code: string | null; fee: number | null }>((sb, from, to) => {
      let q = sb.from("delivery_records").select("rider_id, driver_code, fee")
        .gte("delivery_date", run.period_start).lte("delivery_date", run.period_end);
      if (run.client_id) q = q.eq("client_id", run.client_id);
      return q.range(from, to);
    }, 1000, client),
    fetchAllRows<{ rider_id: string | null; driver_code: string | null; fee: number | null }>((sb, from, to) => {
      let q = (sb as any).from("attendance_logs").select("rider_id, driver_code, fee")
        .gte("log_date", run.period_start).lte("log_date", run.period_end);
      if (run.client_id) q = q.eq("client_id", run.client_id);
      return q.range(from, to);
    }, 1000, client),
  ]);

  const { resolvedIdOf } = await resolveRiderIdentities([...deliveries, ...attendance], client);

  // Cicilan mode='daily' (mis. sewa motor) TETAP kepotong walau rider gak
  // jalan sama sekali periode ini (masih megang unit sewaannya) — rider kayak
  // gini gak akan pernah ke-discover dari delivery/attendance doang, jadi
  // rider_id-nya di-union duluan ke riderIds di bawah.
  const { data: dailyInstallmentsRaw } = await client
    .from("rider_installments")
    .select("rider_id")
    .eq("active", true)
    .eq("mode", "daily");
  const dailyChargeRiderIds = new Set((dailyInstallmentsRaw ?? []).map((r) => r.rider_id));

  const riderIds = [...new Set([
    ...deliveries.map(resolvedIdOf),
    ...attendance.map(resolvedIdOf),
    ...dailyChargeRiderIds,
  ])].filter((id): id is string => !!id);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let riders: any[] = [];
  if (riderIds.length > 0) {
    const { data, error } = await client.from("riders")
      .select("id, client_id, employee_id, full_name")
      .in("id", riderIds);
    if (error) throw error;
    riders = data ?? [];
  }

  const [{ data: installments }, { data: autoTypes }] = await Promise.all([
    client.from("rider_installments").select("*").eq("active", true)
      .lte("next_deduction_date", run.period_end),
    (client as any).from("deduction_types").select("id, name, recurring_amount, trigger_frequency")
      .eq("active", true).eq("auto_recurring", true),
  ]);

  // Auto-recurring "monthly_once" (mis. BPJS) cuma boleh kepotong SEKALI per
  // bulan kalender per rider, LINTAS CLIENT manapun dia digaji — beda dari
  // "every_payroll_run" (default) yang emang kepotong tiap run. Tanpa ini,
  // client dengan >1 periode/bulan bakal kena BPJS berkali-kali.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const monthlyTypeIds = ((autoTypes ?? []) as any[])
    .filter((t) => t.trigger_frequency === "monthly_once")
    .map((t) => t.id);
  const chargedThisMonth = new Set<string>();
  if (monthlyTypeIds.length > 0 && riderIds.length > 0) {
    const runMonth = run.period_end.slice(0, 7); // 'YYYY-MM'
    const monthStart = `${runMonth}-01`;
    const monthEnd = new Date(Number(runMonth.slice(0, 4)), Number(runMonth.slice(5, 7)), 0)
      .toISOString().slice(0, 10); // hari terakhir bulan itu
    const { data: runsThisMonth } = await (client as any).from("payroll_runs")
      .select("id").gte("period_end", monthStart).lte("period_end", monthEnd);
    const runIdsThisMonth = (runsThisMonth ?? []).map((r: { id: string }) => r.id);
    if (runIdsThisMonth.length > 0) {
      const { data: detailsThisMonth } = await (client as any).from("payroll_details")
        .select("id, rider_id").in("run_id", runIdsThisMonth).in("rider_id", riderIds);
      const detailIdToRider = new Map(
        (detailsThisMonth ?? []).map((d: { id: string; rider_id: string }) => [d.id, d.rider_id]),
      );
      const detailIds = [...detailIdToRider.keys()];
      if (detailIds.length > 0) {
        const { data: dedsThisMonth } = await (client as any).from("payroll_deductions")
          .select("detail_id, deduction_type_id").in("detail_id", detailIds).in("deduction_type_id", monthlyTypeIds);
        for (const d of (dedsThisMonth ?? []) as { detail_id: string; deduction_type_id: string }[]) {
          const rId = detailIdToRider.get(d.detail_id);
          if (rId) chargedThisMonth.add(`${rId}|${d.deduction_type_id}`);
        }
      }
    }
  }

  const spanDays = Math.round(
    (new Date(`${run.period_end}T00:00:00Z`).getTime() - new Date(`${run.period_start}T00:00:00Z`).getTime()) / 86_400_000,
  ) + 1;

  // Cross-client dedup sewa harian: cari hari yang UDAH dipotong di run lain
  // yang periode-nya overlap — biar rider multi-client gak kena dobel.
  const dailyChargedDates = new Map<string, Set<string>>();
  const dailyInstIds = new Set(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((installments ?? []) as any[]).filter((i: any) => i.mode === "daily").map((i: any) => i.id),
  );
  if (dailyChargeRiderIds.size > 0 && dailyInstIds.size > 0) {
    const { data: overlapRuns } = await (client as any).from("payroll_runs")
      .select("id, period_start, period_end")
      .lte("period_start", run.period_end)
      .gte("period_end", run.period_start)
      .neq("id", run.id);
    if (overlapRuns?.length) {
      const runPeriod = new Map<string, { s: string; e: string }>();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const r of overlapRuns as any[]) runPeriod.set(r.id, { s: r.period_start, e: r.period_end });
      const { data: oDetails } = await (client as any).from("payroll_details")
        .select("id, run_id, rider_id")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .in("run_id", (overlapRuns as any[]).map((r) => r.id))
        .in("rider_id", [...dailyChargeRiderIds]);
      if (oDetails?.length) {
        const dMap = new Map<string, { runId: string; riderId: string }>();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const d of oDetails as any[]) dMap.set(d.id, { runId: d.run_id, riderId: d.rider_id });
        const { data: oDeds } = await (client as any).from("payroll_deductions")
          .select("detail_id, installment_id")
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .in("detail_id", (oDetails as any[]).map((d) => d.id))
          .not("installment_id", "is", null);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const ded of (oDeds ?? []) as any[]) {
          if (!dailyInstIds.has(ded.installment_id)) continue;
          const info = dMap.get(ded.detail_id);
          if (!info) continue;
          const p = runPeriod.get(info.runId);
          if (!p) continue;
          const key = `${info.riderId}|${ded.installment_id}`;
          if (!dailyChargedDates.has(key)) dailyChargedDates.set(key, new Set());
          const dates = dailyChargedDates.get(key)!;
          const end = new Date(`${p.e}T00:00:00Z`);
          for (const dt = new Date(`${p.s}T00:00:00Z`); dt <= end; dt.setUTCDate(dt.getUTCDate() + 1)) {
            dates.add(dt.toISOString().slice(0, 10));
          }
        }
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const detailsToInsert: any[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deductionsToInsert: any[] = [];

  for (const rider of riders ?? []) {
    const rDelivs = deliveries.filter((d) => resolvedIdOf(d) === rider.id);
    const rAttend = attendance.filter((a) => resolvedIdOf(a) === rider.id);

    const deliveryFee = rDelivs.reduce((s, d) => s + Number(d.fee || 0), 0);
    const deliveryCount = rDelivs.length;
    const attendanceFee = rAttend.reduce((s, a) => s + Number(a.fee || 0), 0);

    // Rider yang gak ada kerja sama sekali periode ini TETAP dibikinin baris
    // payroll kalau dia punya cicilan mode='daily' aktif (sewa jalan terus
    // walau rider libur) — asal client run ini emang "rumah"-nya rider itu
    // (atau run "Semua Client"), biar gak dobel-tagih di run client lain.
    const hasDailyCharge =
      dailyChargeRiderIds.has(rider.id) && (run.client_id === null || run.client_id === rider.client_id);
    if (deliveryCount === 0 && attendanceFee === 0 && !hasDailyCharge) continue;

    const incentiveTotal = 0;
    const penalty = 0;
    const gross = deliveryFee + attendanceFee + incentiveTotal - penalty;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rInstall = (installments ?? []).filter((i: any) => i.rider_id === rider.id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dedItems = rInstall.map((i: any) => {
      if (i.mode === "daily") {
        const rate = Number(i.daily_rate || 0);
        const charged = dailyChargedDates.get(`${rider.id}|${i.id}`);
        let days = spanDays;
        if (charged?.size) {
          days = 0;
          const end = new Date(`${run.period_end}T00:00:00Z`);
          for (const d = new Date(`${run.period_start}T00:00:00Z`); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
            if (!charged.has(d.toISOString().slice(0, 10))) days++;
          }
        }
        return { amount: rate * days, days };
      }
      return { amount: Number(i.per_period_amount || 0), days: 0 };
    });
    const installTotal = dedItems.reduce((s, d) => s + d.amount, 0);

    const autoApplicable = gross > 0
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? ((autoTypes ?? []) as any[]).filter((t) => !(t.trigger_frequency === "monthly_once" && chargedThisMonth.has(`${rider.id}|${t.id}`)))
      : [];
    const autoTotal = autoApplicable.reduce((s: number, t) => s + (Number(t.recurring_amount) || 0), 0);

    const totalDed = installTotal + autoTotal;
    const net = Math.max(0, gross - totalDed);
    const detailId = crypto.randomUUID();
    // Prioritaskan client dari run (deliveries/attendance di atas udah
    // di-filter pakai run.client_id, jadi itu client yang BENERAN dihitung
    // periode ini) — fallback ke rider.client_id cuma buat run "Semua Client"
    // (run.client_id null) biar tetep ada label, bukan kosong.
    detailsToInsert.push({
      id: detailId, run_id: run.id, rider_id: rider.id, client_id: run.client_id ?? rider.client_id,
      delivery_count: deliveryCount, delivery_fee: deliveryFee,
      attendance_fee: attendanceFee, incentive: incentiveTotal, penalty,
      gross_earning: gross, total_deduction: totalDed, net_pay: net,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rInstall.forEach((ins: any, idx: number) => {
      const item = dedItems[idx];
      if (item.amount <= 0) return;
      deductionsToInsert.push({
        detail_id: detailId, deduction_type_id: ins.deduction_type_id,
        installment_id: ins.id,
        description: ins.mode === "daily"
          ? `Sewa ${item.days} hari x Rp${Number(ins.daily_rate || 0).toLocaleString("id-ID")}`
          : `Cicilan ${ins.installments_paid + 1}/${ins.installment_count}`,
        amount: item.amount,
      });
    });
    for (const t of autoApplicable) {
      const amt = Number(t.recurring_amount) || 0;
      if (amt <= 0) continue;
      deductionsToInsert.push({
        detail_id: detailId, deduction_type_id: t.id,
        installment_id: null, description: t.name, amount: amt,
      });
    }
  }

  if (detailsToInsert.length) {
    const { error: e1 } = await client.from("payroll_details").insert(detailsToInsert);
    if (e1) throw e1;
  }
  if (deductionsToInsert.length) {
    const { error: e2 } = await client.from("payroll_deductions").insert(deductionsToInsert);
    if (e2) throw e2;
  }

  return { detailCount: detailsToInsert.length };
}

// Cari payroll_runs yang PERSIS cocok (client_id + period_start + period_end),
// belum published — kalau ada, reuse (recompute di atasnya). Kalau gak ada,
// bikin baru status "draft". Dipanggil otomatis abis commit() di Hitung Fee,
// biar run-nya langsung ready direview di Payroll Run — gak perlu klik "Buat
// Run" manual lagi.
export async function findOrCreatePayrollRun(
  opts: {
    clientId: string | null;
    clientName: string;
    periodStart: string;
    periodEnd: string;
  },
  client: typeof supabase = supabase,
): Promise<PayrollRunLite> {
  let q = (client as any).from("payroll_runs").select("id, client_id, period_start, period_end, status")
    .eq("period_start", opts.periodStart).eq("period_end", opts.periodEnd)
    .neq("status", "published");
  q = opts.clientId ? q.eq("client_id", opts.clientId) : q.is("client_id", null);
  const { data: existing, error: findErr } = await q.limit(1).maybeSingle();
  if (findErr) throw findErr;
  if (existing) return existing;

  const name = `Payroll ${opts.clientName} periode ${opts.periodStart} → ${opts.periodEnd}`;
  const { data: created, error: createErr } = await (client as any).from("payroll_runs")
    .insert({ name, period_type: "weekly", period_start: opts.periodStart, period_end: opts.periodEnd, client_id: opts.clientId })
    .select("id, client_id, period_start, period_end, status").single();
  if (createErr) throw createErr;
  return created;
}
