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

// Urutan pelunasan pas gross gak cukup nutup semua potongan (dipakai di
// publish() buat alokasi gross_earning ke tiap baris payroll_deductions,
// prioritas rendah duluan yang kena kurang). Sesuai kesepakatan: Admin dulu
// (kewajiban rutin kecil), baru BPJS, baru cicilan-cicilan installmentable,
// sewa molis kedua-terakhir, pinjaman kuota paling akhir.
export const DEDUCTION_PRIORITY: Record<string, number> = {
  ADM: 1, BPJS: 2, RUSAK: 3, KASBON: 4, SEWA: 5, KUOTA: 6,
};

// Dipanggil dari publish() di admin.payroll.tsx per baris payroll_deductions
// yang nunjuk ke sebuah cicilan, buat mutusin progress-nya maju atau nggak.
// null = jangan sentuh installments_paid/active sama sekali baris ini.
export function computeInstallmentAdvance(
  ins: { mode: string; installments_paid: number; installment_count: number | null },
  paidInFull: boolean,
): { installments_paid: number; active: boolean } | null {
  // mode='daily'/'monthly' (sewa) open-ended — gak ada installment_count buat
  // dibandingin, tetap aktif sampai admin nonaktifin manual pas unit
  // dikembaliin. Cuma mode='fixed' (cicilan) yang punya progress N/M.
  if (ins.mode === "daily" || ins.mode === "monthly") return null;
  // Baris ini gak lunas penuh (kena alokasi prioritas di publish()) — jangan
  // tandain progress maju, sisa kurangnya udah otomatis nempel jadi tunggakan
  // (lihat getCarriedArrears) buat ketagih lagi di run berikutnya.
  if (!paidInFull) return null;
  const paid = ins.installments_paid + 1;
  const done = paid >= (ins.installment_count ?? 0);
  return { installments_paid: paid, active: !done };
}

// Tunggakan yang ke-bawa dari periode sebelumnya: nyari baris payroll_deductions
// TERAKHIR yang udah di-publish (paid_amount ke-isi) buat installment/jenis yang
// sama, selisih amount-paid_amount-nya itu tunggakannya. Idempotent kayak
// closedCyclesByInst di atas — murni derive dari histori (bukan state yang
// di-mutate), dan aman diulang: begitu satu baris lunas penuh, unpaid-nya 0,
// gak nempel lagi ke periode berikutnya.
//
// byRiderType di-key PER CLIENT (bukan cuma rider+jenis) — auto-recurring
// "every_payroll_run" (mis. Biaya Admin) kepotong di SETIAP client, jadi 1
// rider bisa punya 2 tunggakan Biaya Admin yang KEBETULAN period_end-nya
// sama persis (2 client beda). Kalau di-key cuma rider+jenis, salah satunya
// bakal ketimpa "latest" yang lain dan HILANG (bukan ke-tagih lagi di mana
// pun). Per-client jaga dua-duanya tetap ke-tagih terpisah, dan tunggakan
// client A cuma diambil alih run client A berikutnya — gak bisa nyasar
// ketagih dobel di client B.
async function getCarriedArrears(
  installmentIds: string[],
  autoTypeIds: string[],
  excludeRunId: string,
  client: typeof supabase,
): Promise<{ byInstallment: Map<string, number>; byRiderType: Map<string, number> }> {
  const byInstallment = new Map<string, number>();
  const byRiderType = new Map<string, number>();
  if (installmentIds.length === 0 && autoTypeIds.length === 0) {
    return { byInstallment, byRiderType };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: any[] = [];
  if (installmentIds.length > 0) {
    const { data } = await (client as any).from("payroll_deductions")
      .select("id, detail_id, installment_id, deduction_type_id, amount, paid_amount")
      .in("installment_id", installmentIds).not("paid_amount", "is", null);
    rows.push(...(data ?? []));
  }
  if (autoTypeIds.length > 0) {
    const { data } = await (client as any).from("payroll_deductions")
      .select("id, detail_id, installment_id, deduction_type_id, amount, paid_amount")
      .in("deduction_type_id", autoTypeIds).is("installment_id", null).not("paid_amount", "is", null);
    rows.push(...(data ?? []));
  }
  if (rows.length === 0) return { byInstallment, byRiderType };

  const detailIds = [...new Set(rows.map((r) => r.detail_id))];
  const { data: details } = await (client as any).from("payroll_details")
    .select("id, run_id, rider_id, client_id").in("id", detailIds);
  const detailInfo = new Map<string, { id: string; run_id: string; rider_id: string; client_id: string | null }>(
    (details ?? []).map((d: { id: string; run_id: string; rider_id: string; client_id: string | null }) => [d.id, d]),
  );
  const runIds = [...new Set([...detailInfo.values()].map((d) => d.run_id))].filter((id) => id !== excludeRunId);
  const { data: runs } = await (client as any).from("payroll_runs").select("id, period_end").in("id", runIds);
  const periodEndOfRun = new Map<string, string>(
    (runs ?? []).map((r: { id: string; period_end: string }) => [r.id, r.period_end]),
  );

  const latestByInstallment = new Map<string, { periodEnd: string; unpaid: number }>();
  const latestByRiderType = new Map<string, { periodEnd: string; unpaid: number }>();
  for (const r of rows) {
    const info = detailInfo.get(r.detail_id);
    if (!info || info.run_id === excludeRunId) continue;
    const periodEnd = periodEndOfRun.get(info.run_id);
    if (!periodEnd) continue;
    const unpaid = Math.max(0, Number(r.amount) - Number(r.paid_amount));
    if (r.installment_id) {
      const cur = latestByInstallment.get(r.installment_id);
      if (!cur || periodEnd > cur.periodEnd) latestByInstallment.set(r.installment_id, { periodEnd, unpaid });
    } else {
      const key = `${info.rider_id}|${r.deduction_type_id}|${info.client_id ?? ""}`;
      const cur = latestByRiderType.get(key);
      if (!cur || periodEnd > cur.periodEnd) latestByRiderType.set(key, { periodEnd, unpaid });
    }
  }
  for (const [k, v] of latestByInstallment) byInstallment.set(k, v.unpaid);
  for (const [k, v] of latestByRiderType) byRiderType.set(k, v.unpaid);
  return { byInstallment, byRiderType };
}

const DAY_MS = 86_400_000;

// Siklus tagihan custom mode='monthly' (mis. 25 - 24 bulan depannya, bukan
// kalender 1-31) — csd = "cycle start day". Semua tanggal UTC-midnight biar
// gak kena geser timezone.
function cycleStartOf(cycleEnd: Date, csd: number): Date {
  return new Date(Date.UTC(cycleEnd.getUTCFullYear(), cycleEnd.getUTCMonth() - 1, csd));
}
function cycleEndAfter(cycleEnd: Date, csd: number): Date {
  return new Date(Date.UTC(cycleEnd.getUTCFullYear(), cycleEnd.getUTCMonth() + 1, csd - 1));
}
function cycleEndContaining(date: Date, csd: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const d = date.getUTCDate();
  return d >= csd ? new Date(Date.UTC(y, m + 1, csd - 1)) : new Date(Date.UTC(y, m, csd - 1));
}
// Jumlah hari yang masih "kepending" (belum ke-charge di run lain) buat 1
// installment mode='monthly', dari siklus yang ngandung start_date sampai
// siklus yang cycle_end-nya <= period_end run ini. Dipanggil idempotent —
// murni dari riwayat payroll_deductions (closedCycles), bukan state yang
// di-mutate — jadi generate ulang run yang sama selalu ngasih hasil sama.
function monthlyDueDays(
  inst: { id: string; start_date: string; cycle_start_day: number | null },
  periodEndStr: string,
  closedCyclesByInst: Map<string, Set<string>>,
): number {
  const csd = inst.cycle_start_day || 25;
  const startDate = new Date(`${inst.start_date}T00:00:00Z`);
  const periodEnd = new Date(`${periodEndStr}T00:00:00Z`);
  const closed = closedCyclesByInst.get(inst.id) ?? new Set<string>();
  let cycleEnd = cycleEndContaining(startDate, csd);
  let totalDays = 0;
  while (cycleEnd <= periodEnd) {
    if (!closed.has(cycleEnd.toISOString().slice(0, 10))) {
      const cycleStart = cycleStartOf(cycleEnd, csd);
      const effectiveStart = cycleStart > startDate ? cycleStart : startDate;
      totalDays += Math.round((cycleEnd.getTime() - effectiveStart.getTime()) / DAY_MS) + 1;
    }
    cycleEnd = cycleEndAfter(cycleEnd, csd);
  }
  return totalDays;
}

// `client` opsional: default-nya client browser (anon) yang dipakai selama ini
// dari Hitung Fee/Payroll Run. Cron/workflow server-only (gak ada session admin)
// wajib kirim getSupabaseAdmin() di sini — lihat payroll-workflow.server.ts.
export async function generatePayrollDetails(
  run: PayrollRunLite,
  client: typeof supabase = supabase,
): Promise<{ detailCount: number }> {
  // Delete lama + insert baru kejadian di UJUNG fungsi ini, dalam satu RPC
  // (satu transaction Postgres) — biar kalau ada apa pun yang gagal/throw di
  // tengah komputasi di bawah, payroll_details/payroll_deductions run ini
  // TIDAK kesentuh sama sekali (bukan keburu ke-delete duluan). Makanya semua
  // query dedup di bawah (BPJS bulanan, siklus sewa monthly) explicit exclude
  // run.id sendiri — dulu itu didapat gratis dari delete-di-awal ini.
  const [deliveries, attendance] = await Promise.all([
    fetchAllRows<{ rider_id: string | null; driver_code: string | null; fee: number | null }>((sb, from, to) => {
      // Cuma order status='COMPLETED' yang boleh masuk gaji — samain sama Hitung
      // Fee (admin.calculate.tsx) yang emang cuma nge-zip baris COMPLETED.
      // Tanpa ini, order FAILED/PENDING_PICKUP ikut ngisi delivery_count (dan
      // fee-nya kalau suatu saat kebetulan udah keisi sebelum status final).
      let q = sb.from("delivery_records").select("rider_id, driver_code, fee")
        .eq("status", "COMPLETED")
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

  // Cicilan mode='monthly' (mis. sewa molis yang disepakati potong SEKALI per
  // bulan, bukan harian x hari) — sama alasannya kayak dailyChargeRiderIds di
  // atas: rider gak akan ke-discover dari delivery/attendance doang.
  const { data: monthlyInstallmentsRaw } = await client
    .from("rider_installments")
    .select("rider_id")
    .eq("active", true)
    .eq("mode", "monthly");
  const monthlyChargeRiderIds = new Set((monthlyInstallmentsRaw ?? []).map((r) => r.rider_id));

  const riderIds = [...new Set([
    ...deliveries.map(resolvedIdOf),
    ...attendance.map(resolvedIdOf),
    ...dailyChargeRiderIds,
    ...monthlyChargeRiderIds,
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
    (client as any).from("deduction_types").select("id, name, recurring_amount, trigger_frequency, applies_to_all")
      .eq("active", true).eq("auto_recurring", true),
  ]);

  // applies_to_all=false (mis. BPJS yang cuma sebagian rider ikut) — cuma
  // rider yang terdaftar di deduction_type_riders yang kena, bukan semua
  // rider yang ada penghasilan kayak default-nya.
  const restrictedTypeIds = ((autoTypes ?? []) as any[]).filter((t) => !t.applies_to_all).map((t) => t.id);
  const enrolledSet = new Set<string>();
  // Client prioritas per enrollment (mis. BPJS JKK rider X ditanggung client A
  // spesifik) — null = fallback ke client rumah rider, sama kayak sebelum ada
  // kolom ini (lihat matchesClient di loop rider bawah).
  const enrolledClient = new Map<string, string | null>();
  if (restrictedTypeIds.length > 0) {
    const { data: enrolled } = await (client as any).from("deduction_type_riders")
      .select("deduction_type_id, rider_id, client_id").in("deduction_type_id", restrictedTypeIds);
    for (const e of (enrolled ?? []) as { deduction_type_id: string; rider_id: string; client_id: string | null }[]) {
      const key = `${e.deduction_type_id}|${e.rider_id}`;
      enrolledSet.add(key);
      enrolledClient.set(key, e.client_id);
    }
  }

  // Tunggakan yang belum lunas dari run sebelumnya (lihat getCarriedArrears) —
  // ditambahin ke tagihan periode ini biar otomatis ketagih lagi, bukan hilang.
  const { byInstallment: arrearsByInstallment, byRiderType: arrearsByRiderType } = await getCarriedArrears(
    (installments ?? []).map((i: { id: string }) => i.id),
    ((autoTypes ?? []) as { id: string }[]).map((t) => t.id),
    run.id,
    client,
  );

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
      .select("id").gte("period_end", monthStart).lte("period_end", monthEnd).neq("id", run.id);
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

  // Cicilan mode='monthly' (sewa molis, ditagih sekaligus per siklus custom,
  // mis. 25 - 24 bulan depannya — bisa beda csd per assignment). Dedup-nya
  // BUKAN dari state yang di-mutate (biar "Generate Ulang" run yang sama
  // tetap idempotent), tapi dari riwayat payroll_deductions run LAIN: tiap
  // baris deduction lama nunjuk ke sebuah run, period_end run itu dipetain
  // balik ke siklus mana yang udah "ketutup"-nya lewat cycleEndContaining.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const monthlyInsts = ((installments ?? []) as any[]).filter((i: any) => i.mode === "monthly");
  const closedCyclesByInst = new Map<string, Set<string>>();
  if (monthlyInsts.length > 0) {
    const monthlyInstIds = monthlyInsts.map((i) => i.id);
    const { data: priorDeds } = await (client as any).from("payroll_deductions")
      .select("installment_id, detail_id").in("installment_id", monthlyInstIds);
    if (priorDeds?.length) {
      const detailIds = [...new Set((priorDeds as any[]).map((d) => d.detail_id))];
      const { data: detailRuns } = await (client as any).from("payroll_details")
        .select("id, run_id").in("id", detailIds);
      const runIdOfDetail = new Map(
        (detailRuns ?? []).map((d: { id: string; run_id: string }) => [d.id, d.run_id]),
      );
      const runIds = [...new Set([...runIdOfDetail.values()])];
      const { data: runsData } = await (client as any).from("payroll_runs")
        .select("id, period_end").in("id", runIds);
      const periodEndOfRun = new Map(
        (runsData ?? []).map((r: { id: string; period_end: string }) => [r.id, r.period_end]),
      );
      for (const d of priorDeds as { installment_id: string; detail_id: string }[]) {
        const runId = runIdOfDetail.get(d.detail_id);
        if (runId === run.id) continue; // punya run ini sendiri, belum ke-delete — jangan itung diri sendiri
        const periodEnd = runId ? periodEndOfRun.get(runId) : null;
        if (!periodEnd) continue;
        const inst = monthlyInsts.find((i) => i.id === d.installment_id);
        if (!inst) continue;
        const closedEnd = cycleEndContaining(new Date(`${periodEnd}T00:00:00Z`), inst.cycle_start_day || 25);
        const set = closedCyclesByInst.get(d.installment_id) ?? new Set<string>();
        set.add(closedEnd.toISOString().slice(0, 10));
        closedCyclesByInst.set(d.installment_id, set);
      }
    }
  }

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

    // Client prioritas per potongan (rider_installments.client_id) menang atas
    // client rumah rider (riders.client_id) — null di keduanya berarti run
    // "Semua Client" (run.client_id null) selalu match, biar tetep ada
    // fallback lama buat baris yang belum diisi client prioritasnya.
    const matchesClient = (targetClientId: string | null | undefined) =>
      run.client_id === null || run.client_id === (targetClientId ?? rider.client_id);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rInstall = (installments ?? []).filter((i: any) => i.rider_id === rider.id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rInstallForRun = rInstall.filter((i: any) => matchesClient(i.client_id));

    // Rider yang gak ada kerja sama sekali periode ini TETAP dibikinin baris
    // payroll kalau dia punya cicilan mode='daily' aktif (sewa jalan terus
    // walau rider libur) — asal client-nya (prioritas atau rumah rider) match
    // run ini (atau run "Semua Client"), biar gak dobel-tagih di run client lain.
    const hasDailyCharge = rInstallForRun.some((i: any) => i.mode === "daily");
    // mode='monthly' cuma butuh baris kalau siklusnya BENERAN nutup di run
    // ini (monthlyDueDays > 0) — beda dari 'daily' yang selalu >0, run lain
    // dalam siklus yang sama harusnya gak bikin baris kosong percuma.
    const hasMonthlyChargeDue = rInstallForRun.some(
      (i: any) => i.mode === "monthly" && monthlyDueDays(i, run.period_end, closedCyclesByInst) > 0,
    );
    if (deliveryCount === 0 && attendanceFee === 0 && !hasDailyCharge && !hasMonthlyChargeDue) continue;

    const incentiveTotal = 0;
    const penalty = 0;
    const gross = deliveryFee + attendanceFee + incentiveTotal - penalty;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dedItems = rInstallForRun.map((i: any) => {
      const arrears = arrearsByInstallment.get(i.id) ?? 0;
      if (i.mode === "daily") {
        const rate = Number(i.daily_rate || 0);
        const charged = dailyChargedDates.get(`${rider.id}|${i.id}`);
        // Tanggal PERSIS yang kena di periode ini (bukan cuma count) — biar
        // recap/slip bisa nunjukin hari mana yang beneran kepotong, bukan
        // cuma rentang periode run (yang bisa salah kalau sebagian harinya
        // udah kepotong run lain, lihat dailyChargedDates di atas).
        const chargedDates: string[] = [];
        const end = new Date(`${run.period_end}T00:00:00Z`);
        for (const d = new Date(`${run.period_start}T00:00:00Z`); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
          const iso = d.toISOString().slice(0, 10);
          if (!charged?.has(iso)) chargedDates.push(iso);
        }
        const days = chargedDates.length;
        return { amount: rate * days + arrears, days, arrears, chargedDates };
      }
      if (i.mode === "monthly") {
        const days = monthlyDueDays(i, run.period_end, closedCyclesByInst);
        return { amount: Number(i.daily_rate || 0) * days + arrears, days, arrears, chargedDates: [] as string[] };
      }
      return { amount: Number(i.per_period_amount || 0) + arrears, days: 0, arrears, chargedDates: [] as string[] };
    });
    // charge_target='client_revenue' (mis. molis gratis buat rider, kita yang
    // nanggung sewanya) TIDAK ngurangin net_pay rider — biayanya kena di sisi
    // P&L client lewat molis-cost.ts, bukan di sini. Baris deduction tetap
    // dicatat di bawah (audit trail), cuma gak masuk ke installTotal.
    const installTotal = dedItems.reduce(
      (s, d, idx) => s + ((rInstallForRun[idx] as any).charge_target === "client_revenue" ? 0 : d.amount),
      0,
    );

    // Auto-recurring (Biaya Admin, BPJS) kepotong per payroll detail TANPA
    // syarat gross>0 — sama kayak deduction cicilan (dedItems) di atas, biar
    // konsisten: rider yang punya activity di client ini (walau gross-nya nol
    // periode ini) tetap kena, gak digantung nunggu ada gross. Shortfall yang
    // muncul (total_deduction > gross_earning) ditangani jalur netting yang
    // udah ada di admin.payroll.tsx, bukan di-skip diam-diam di sini.
    // Restricted type (applies_to_all=false, mis. BPJS JKK) yang enrollment-nya
    // punya client prioritas sendiri (deduction_type_riders.client_id) — cuma
    // kepotong di run client itu, sama logikanya kayak matchesClient di atas.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const autoApplicable = ((autoTypes ?? []) as any[]).filter((t) => {
      if (t.trigger_frequency === "monthly_once" && chargedThisMonth.has(`${rider.id}|${t.id}`)) return false;
      if (t.applies_to_all) return true;
      const key = `${t.id}|${rider.id}`;
      return enrolledSet.has(key) && matchesClient(enrolledClient.get(key));
    });
    // Key arrears sama persis cara detail-nya nanti disimpen (client_id run
    // ini, fallback ke client rumah rider) — biar tunggakan client A cuma
    // pernah keambil sama run client A lagi, gak nyasar ke client B.
    const detailClientId = run.client_id ?? rider.client_id;
    const autoItems = autoApplicable.map((t) => {
      const arrears = arrearsByRiderType.get(`${rider.id}|${t.id}|${detailClientId ?? ""}`) ?? 0;
      return { t, amount: (Number(t.recurring_amount) || 0) + arrears, arrears };
    });
    const autoTotal = autoItems.reduce((s: number, x) => s + x.amount, 0);

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
    rInstallForRun.forEach((ins: any, idx: number) => {
      const item = dedItems[idx];
      if (item.amount <= 0) return;
      const isClientRevenue =
        (ins.mode === "daily" || ins.mode === "monthly") && ins.charge_target === "client_revenue";
      const revenueNote = isClientRevenue ? " (ditanggung revenue client, tidak potong net pay)" : "";
      const cycleNote = ins.mode === "monthly" ? ` (potong per siklus tgl ${ins.cycle_start_day || 25})` : "";
      const arrearsNote = item.arrears > 0 ? ` + tunggakan Rp${item.arrears.toLocaleString("id-ID")}` : "";
      // Tanggal PERSIS yang kepotong (mode daily) — bukan cuma rentang periode
      // run, biar keliatan kalau sebagian harinya udah kepotong run lain (lihat
      // dailyChargedDates) dan Recap/slip gak nunjukin rentang yang menyesatkan.
      const datesNote =
        ins.mode === "daily" && item.chargedDates.length > 0
          ? ` (tgl ${item.chargedDates.map((d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`).join(", ")})`
          : "";
      const description =
        ins.mode === "daily" || ins.mode === "monthly"
          ? `Sewa ${item.days} hari x Rp${Number(ins.daily_rate || 0).toLocaleString("id-ID")}` + datesNote + arrearsNote + cycleNote + revenueNote
          : `Cicilan ${ins.installments_paid + 1}/${ins.installment_count}` + arrearsNote;
      deductionsToInsert.push({
        detail_id: detailId, deduction_type_id: ins.deduction_type_id,
        installment_id: ins.id,
        description,
        amount: isClientRevenue ? 0 : item.amount,
      });
    });
    for (const x of autoItems) {
      const t = x.t;
      if (x.amount <= 0) continue;
      const description = x.arrears > 0 ? `${t.name} + tunggakan Rp${x.arrears.toLocaleString("id-ID")}` : t.name;
      deductionsToInsert.push({
        detail_id: detailId, deduction_type_id: t.id,
        installment_id: null, description, amount: x.amount,
      });
    }
  }

  // Delete-lama + insert-baru dalam SATU RPC/transaction Postgres (lihat
  // regenerate_payroll_details di migration) — kalau ini gagal, payroll_details
  // run ini tetap utuh persis kayak sebelum "Generate Ulang" ditekan, bukan
  // ketinggalan kosong/separuh.
  const { error } = await (client as any).rpc("regenerate_payroll_details", {
    p_run_id: run.id,
    p_details: detailsToInsert,
    p_deductions: deductionsToInsert,
  });
  if (error) throw error;

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
