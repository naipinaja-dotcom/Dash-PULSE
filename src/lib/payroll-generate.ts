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
  // EWA = upah yang SUDAH dicairkan duluan, jadi harus kepotong paling pertama
  // (kode yang gak terdaftar di sini jatuh ke 99 = paling akhir, salah buat EWA).
  EWA: 0,
  ADM: 1,
  BPJS: 2,
  RUSAK: 3,
  KASBON: 4,
  SEWA: 5,
  KUOTA: 6,
};

export interface MultiClientShare {
  clientId: string;
  amount: number;
  arrearsPortion: number;
}

// Cicilan mode='fixed'/'monthly' yang eligible di >1 client (rider_installments.
// client_ids) — pecah `arrears + baseAmount` jadi beberapa baris LINTAS CLIENT
// sesuai urutan prioritas admin (client_ids), tiap client nanggung sebesar
// gross-nya SENDIRI sampai abis, sisanya jalan ke client prioritas berikutnya
// (waterfall). BEDA dari model lama (winner-take-all, 1 client nanggung
// SEMUA) — itu ninggalin gross client lain "nganggur" walau rider beneran
// jalan di situ juga periode ini, padahal maksud fitur ini justru buat
// NGELENGKAPIN kekurangan potongan pakai client lain, bukan mindahin semua
// potongan ke 1 client aja (lihat kasus Lucky Permana/Nahrowi — winner-take-
// all pernah kepake bareng bug dedup exact-match, hasilnya malah DOBEL
// charge; begitu dedup-nya bener pun winner-take-all masih nyisain uang di
// meja kalau kedua client SAMA-SAMA gak cukup sendiri-sendiri tapi
// gabungannya cukup).
//
// `grossByClient` cuma isi client yang KETAHUAN aktif periode ini (diri
// sendiri + sibling yang run-nya udah ada di DB, lihat siblingGrossByRiderClient
// di generatePayrollDetails) — client yang belum digenerate sama sekali gak
// ikut keitung, konsisten sama filosofi "idempotent kalau di-Generate Ulang"
// yang udah dipakai fitur ini dari awal.
//
// Jumlah SELURUH `amount` hasil fungsi ini SELALU PERSIS `arrears+baseAmount`
// (gak pernah kurang) — client PALING TERAKHIR yang eligible & aktif periode
// ini nanggung SISA APAPUN yang gak ke-cover gross client-client sebelumnya,
// bahkan kalau gross-nya sendiri juga gak cukup. Ini PENTING buat
// getCarriedArrears (tunggakan next cycle): kalau totalnya gak pernah
// di-"tagih" penuh di SALAH SATU baris, kekurangan yang beneran gak
// collectible bakal hilang diam-diam (bukan ke-carry ke next cycle) —
// bukan "dilengkapin", malah "diputihin".
export function allocateMultiClientDeduction(
  arrears: number,
  baseAmount: number,
  clientIdsPriority: string[],
  grossByClient: Map<string, number>,
): MultiClientShare[] {
  const present = clientIdsPriority.filter((cid) => grossByClient.has(cid));
  if (present.length === 0) return [];
  let remainingTotal = Math.max(0, arrears) + Math.max(0, baseAmount);
  let remainingArrears = Math.max(0, arrears);
  const out: MultiClientShare[] = [];
  present.forEach((clientId, idx) => {
    const isLast = idx === present.length - 1;
    const gross = Math.max(0, grossByClient.get(clientId) ?? 0);
    const amount = isLast ? remainingTotal : Math.min(remainingTotal, gross);
    const arrearsPortion = Math.min(amount, remainingArrears);
    remainingArrears -= arrearsPortion;
    remainingTotal -= amount;
    out.push({ clientId, amount, arrearsPortion });
  });
  return out;
}

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
    const { data } = await (client as any)
      .from("payroll_deductions")
      .select("id, detail_id, installment_id, deduction_type_id, amount, paid_amount")
      .in("installment_id", installmentIds)
      .not("paid_amount", "is", null);
    rows.push(...(data ?? []));
  }
  if (autoTypeIds.length > 0) {
    const { data } = await (client as any)
      .from("payroll_deductions")
      .select("id, detail_id, installment_id, deduction_type_id, amount, paid_amount")
      .in("deduction_type_id", autoTypeIds)
      .is("installment_id", null)
      .not("paid_amount", "is", null);
    rows.push(...(data ?? []));
  }
  if (rows.length === 0) return { byInstallment, byRiderType };

  const detailIds = [...new Set(rows.map((r) => r.detail_id))];
  const { data: details } = await (client as any)
    .from("payroll_details")
    .select("id, run_id, rider_id, client_id")
    .in("id", detailIds);
  const detailInfo = new Map<
    string,
    { id: string; run_id: string; rider_id: string; client_id: string | null }
  >(
    (details ?? []).map(
      (d: { id: string; run_id: string; rider_id: string; client_id: string | null }) => [d.id, d],
    ),
  );
  const runIds = [...new Set([...detailInfo.values()].map((d) => d.run_id))].filter(
    (id) => id !== excludeRunId,
  );
  const { data: runs } = await (client as any)
    .from("payroll_runs")
    .select("id, period_start, period_end")
    .in("id", runIds);
  const periodOfRun = new Map<string, { start: string; end: string }>(
    (runs ?? []).map((r: { id: string; period_start: string; period_end: string }) => [
      r.id,
      { start: r.period_start, end: r.period_end },
    ]),
  );

  // Cicilan multi-client (allocateMultiClientDeduction) bisa displit jadi
  // >1 baris LINTAS CLIENT buat 1 periode yang sama (periode overlap, bukan
  // identik — beda client beda siklus payroll). "Latest row menang" aja gak
  // cukup lagi buat kasus ini: cuma ngambil SATU baris (bisa aja yang PALING
  // KECIL porsinya) dan ngelewatin sisa baris sibling-nya yang justru nyimpen
  // sebagian besar tunggakan. Grouping baru: ambil baris ber-period_end
  // TERBARU per installment sebagai anchor, lalu JUMLAHIN unpaid semua baris
  // lain yang periode-nya OVERLAP anchor itu (installment single-client tetap
  // cuma 1 baris per periode seperti biasa, hasilnya identik logic lama).
  type ResolvedRow = {
    installmentId: string | null;
    riderId: string;
    clientId: string | null;
    deductionTypeId: string;
    unpaid: number;
    period: { start: string; end: string };
  };
  const resolved: ResolvedRow[] = [];
  for (const r of rows) {
    const info = detailInfo.get(r.detail_id);
    if (!info || info.run_id === excludeRunId) continue;
    const period = periodOfRun.get(info.run_id);
    if (!period) continue;
    resolved.push({
      installmentId: r.installment_id,
      riderId: info.rider_id,
      clientId: info.client_id,
      deductionTypeId: r.deduction_type_id,
      unpaid: Math.max(0, Number(r.amount) - Number(r.paid_amount)),
      period,
    });
  }

  const rowsByInstallment = new Map<string, ResolvedRow[]>();
  const latestByRiderType = new Map<string, { periodEnd: string; unpaid: number }>();
  for (const r of resolved) {
    if (r.installmentId) {
      const arr = rowsByInstallment.get(r.installmentId) ?? [];
      arr.push(r);
      rowsByInstallment.set(r.installmentId, arr);
    } else {
      const key = `${r.riderId}|${r.deductionTypeId}|${r.clientId ?? ""}`;
      const cur = latestByRiderType.get(key);
      if (!cur || r.period.end > cur.periodEnd)
        latestByRiderType.set(key, { periodEnd: r.period.end, unpaid: r.unpaid });
    }
  }
  for (const [instId, group] of rowsByInstallment) {
    const anchor = group.reduce((a, b) => (b.period.end > a.period.end ? b : a));
    const overlapping = group.filter(
      (r) => r.period.start <= anchor.period.end && r.period.end >= anchor.period.start,
    );
    byInstallment.set(
      instId,
      overlapping.reduce((s, r) => s + r.unpaid, 0),
    );
  }
  for (const [k, v] of latestByRiderType) byRiderType.set(k, v.unpaid);
  return { byInstallment, byRiderType };
}

// Dipanggil dari publish() di admin.payroll.tsx SEBELUM ngelanjutin
// computeInstallmentAdvance buat baris cicilan yang eligible >1 client
// (allocateMultiClientDeduction bisa mecah 1 periode jadi beberapa baris
// lintas client). Progress (installments_paid) cuma boleh maju SEKALI per
// periode gabungan — kalau tiap baris split ngecek "gua sendiri udah lunas"
// terus maju sendiri-sendiri, cicilan 4x bisa "lunas" cuma dalam 2 periode
// (dobel-advance). Baris ini nunggu SEMUA sibling baris (installment sama,
// periode run-nya overlap, lihat pattern dedup generate-time) juga udah
// paid_amount >= amount — baru progress boleh maju, di publish PALING
// TERAKHIR yang nutup grup itu.
export async function isMultiClientDeductionGroupComplete(
  client: typeof supabase,
  installmentId: string,
  periodStart: string,
  periodEnd: string,
  excludeDeductionRowId: string,
): Promise<boolean> {
  const { data: overlapRuns } = await (client as any)
    .from("payroll_runs")
    .select("id")
    .lte("period_start", periodEnd)
    .gte("period_end", periodStart);
  const runIds = (overlapRuns ?? []).map((r: { id: string }) => r.id);
  if (runIds.length === 0) return true;
  const { data: details } = await (client as any)
    .from("payroll_details")
    .select("id")
    .in("run_id", runIds);
  const detailIds = (details ?? []).map((d: { id: string }) => d.id);
  if (detailIds.length === 0) return true;
  const { data: siblingDeds } = await (client as any)
    .from("payroll_deductions")
    .select("id, amount, paid_amount")
    .eq("installment_id", installmentId)
    .in("detail_id", detailIds)
    .neq("id", excludeDeductionRowId);
  return ((siblingDeds ?? []) as { amount: number; paid_amount: number | null }[]).every(
    (d) => d.paid_amount != null && Number(d.paid_amount) >= Number(d.amount),
  );
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

// Bulan kalender yang "ditutup" sama periode run ini — dipakai buat dedup
// auto-recurring "monthly_once" (BPJS). Threshold tgl>=28 (bukan nunggu hari
// TERAKHIR pasti, 28/29/30/31 beda-beda per bulan) sengaja dibikin toleran:
// run mingguan yang numpang lewat pergantian bulan (mis. 31 Agu-6 Sep) tetap
// keitung "nutup Agustus" (ngelewatin tgl 31, yang >=28), BUKAN "nutup
// September" (belum nyentuh tgl 28-30 Sep sama sekali) — beda dari cek lama
// yang asal liat bulan period_end doang, jadi run kayak gini keitung bulan
// baru padahal bulan sebelumnya udah ketagih duluan sama run sebelumnya
// (regresi: BPJS Alfagift kepotong 2x beda 7 hari pas periode mingguan
// nabrak pergantian bulan). Karena thresholdnya cuma 4 hari (28-31) dan run
// gak overlap, gak mungkin 2 run beda sekaligus "nutup" bulan yang sama.
export function monthsClosedOutBy(
  periodStart: string,
  periodEnd: string,
  thresholdDay = 28,
): string[] {
  const start = new Date(`${periodStart}T00:00:00Z`);
  const end = new Date(`${periodEnd}T00:00:00Z`);
  const months = new Set<string>();
  const cursor = new Date(start);
  while (cursor <= end) {
    if (cursor.getUTCDate() >= thresholdDay) {
      months.add(cursor.toISOString().slice(0, 7));
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return [...months];
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
    fetchAllRows<{ rider_id: string | null; driver_code: string | null; fee: number | null }>(
      (sb, from, to) => {
        // Cuma order status='COMPLETED' yang boleh masuk gaji — samain sama Hitung
        // Fee (admin.calculate.tsx) yang emang cuma nge-zip baris COMPLETED.
        // Tanpa ini, order FAILED/PENDING_PICKUP ikut ngisi delivery_count (dan
        // fee-nya kalau suatu saat kebetulan udah keisi sebelum status final).
        let q = sb
          .from("delivery_records")
          .select("rider_id, driver_code, fee")
          .eq("status", "COMPLETED")
          .gte("delivery_date", run.period_start)
          .lte("delivery_date", run.period_end);
        if (run.client_id) q = q.eq("client_id", run.client_id);
        return q.range(from, to);
      },
      1000,
      client,
    ),
    fetchAllRows<{ rider_id: string | null; driver_code: string | null; fee: number | null }>(
      (sb, from, to) => {
        let q = (sb as any)
          .from("attendance_logs")
          .select("rider_id, driver_code, fee")
          .gte("log_date", run.period_start)
          .lte("log_date", run.period_end);
        if (run.client_id) q = q.eq("client_id", run.client_id);
        return q.range(from, to);
      },
      1000,
      client,
    ),
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

  const riderIds = [
    ...new Set([
      ...deliveries.map(resolvedIdOf),
      ...attendance.map(resolvedIdOf),
      ...dailyChargeRiderIds,
      ...monthlyChargeRiderIds,
    ]),
  ].filter((id): id is string => !!id);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let riders: any[] = [];
  if (riderIds.length > 0) {
    const { data, error } = await client
      .from("riders")
      .select("id, client_id, employee_id, full_name")
      .in("id", riderIds);
    if (error) throw error;
    riders = data ?? [];
  }

  const [{ data: installments }, { data: autoTypes }] = await Promise.all([
    client
      .from("rider_installments")
      .select("*")
      .eq("active", true)
      .lte("next_deduction_date", run.period_end),
    (client as any)
      .from("deduction_types")
      .select("id, name, recurring_amount, trigger_frequency, applies_to_all")
      .eq("active", true)
      .eq("auto_recurring", true),
  ]);

  // applies_to_all=false (mis. BPJS yang cuma sebagian rider ikut) — cuma
  // rider yang terdaftar di deduction_type_riders yang kena, bukan semua
  // rider yang ada penghasilan kayak default-nya.
  const restrictedTypeIds = ((autoTypes ?? []) as any[])
    .filter((t) => !t.applies_to_all)
    .map((t) => t.id);
  const enrolledSet = new Set<string>();
  // Client prioritas per enrollment (mis. BPJS JKK rider X ditanggung client A
  // spesifik) — null = fallback ke client rumah rider, sama kayak sebelum ada
  // kolom ini (lihat matchesClient di loop rider bawah).
  const enrolledClient = new Map<string, string | null>();
  if (restrictedTypeIds.length > 0) {
    const { data: enrolled } = await (client as any)
      .from("deduction_type_riders")
      .select("deduction_type_id, rider_id, client_id")
      .in("deduction_type_id", restrictedTypeIds);
    for (const e of (enrolled ?? []) as {
      deduction_type_id: string;
      rider_id: string;
      client_id: string | null;
    }[]) {
      const key = `${e.deduction_type_id}|${e.rider_id}`;
      enrolledSet.add(key);
      enrolledClient.set(key, e.client_id);
    }
  }

  // Tunggakan yang belum lunas dari run sebelumnya (lihat getCarriedArrears) —
  // ditambahin ke tagihan periode ini biar otomatis ketagih lagi, bukan hilang.
  const { byInstallment: arrearsByInstallment, byRiderType: arrearsByRiderType } =
    await getCarriedArrears(
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
  // Bulan yang beneran ditutup sama run ini (lihat monthsClosedOutBy) — kosong
  // artinya run ini cuma "numpang lewat" tengah bulan, monthly_once SEMUA
  // di-skip di run ini (lihat pemakaian di bawah), nunggu run yang beneran
  // nutup bulannya.
  const closedOutMonths = monthsClosedOutBy(run.period_start, run.period_end);
  const chargedThisMonth = new Set<string>();
  if (monthlyTypeIds.length > 0 && riderIds.length > 0 && closedOutMonths.length > 0) {
    const monthEndDates = closedOutMonths.map((m) => {
      const [y, mo] = m.split("-").map(Number);
      return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10); // hari terakhir bulan itu
    });
    const rangeLo = `${closedOutMonths[0]}-01`;
    const rangeHi = monthEndDates[monthEndDates.length - 1];
    // Kandidat run lain yang overlap rentang bulan ini — masih di-filter lagi
    // di bawah (recompute closedOutMonths run itu sendiri), overlap doang
    // belum tentu run itu yang BENERAN nutup bulannya.
    const { data: candidateRuns } = await (client as any)
      .from("payroll_runs")
      .select("id, period_start, period_end")
      .neq("id", run.id)
      .lte("period_start", rangeHi)
      .gte("period_end", rangeLo);
    const runIdsThisMonth = (
      (candidateRuns ?? []) as { id: string; period_start: string; period_end: string }[]
    )
      .filter((r) =>
        monthsClosedOutBy(r.period_start, r.period_end).some((m) => closedOutMonths.includes(m)),
      )
      .map((r) => r.id);
    if (runIdsThisMonth.length > 0) {
      const { data: detailsThisMonth } = await (client as any)
        .from("payroll_details")
        .select("id, rider_id")
        .in("run_id", runIdsThisMonth)
        .in("rider_id", riderIds);
      const detailIdToRider = new Map(
        (detailsThisMonth ?? []).map((d: { id: string; rider_id: string }) => [d.id, d.rider_id]),
      );
      const detailIds = [...detailIdToRider.keys()];
      if (detailIds.length > 0) {
        const { data: dedsThisMonth } = await (client as any)
          .from("payroll_deductions")
          .select("detail_id, deduction_type_id")
          .in("detail_id", detailIds)
          .in("deduction_type_id", monthlyTypeIds);
        for (const d of (dedsThisMonth ?? []) as {
          detail_id: string;
          deduction_type_id: string;
        }[]) {
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
    const { data: priorDeds } = await (client as any)
      .from("payroll_deductions")
      .select("installment_id, detail_id")
      .in("installment_id", monthlyInstIds);
    if (priorDeds?.length) {
      const detailIds = [...new Set((priorDeds as any[]).map((d) => d.detail_id))];
      const { data: detailRuns } = await (client as any)
        .from("payroll_details")
        .select("id, run_id")
        .in("id", detailIds);
      const runIdOfDetail = new Map(
        (detailRuns ?? []).map((d: { id: string; run_id: string }) => [d.id, d.run_id]),
      );
      const runIds = [...new Set([...runIdOfDetail.values()])];
      const { data: runsData } = await (client as any)
        .from("payroll_runs")
        .select("id, period_end")
        .in("id", runIds);
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
        const closedEnd = cycleEndContaining(
          new Date(`${periodEnd}T00:00:00Z`),
          inst.cycle_start_day || 25,
        );
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
    const { data: overlapRuns } = await (client as any)
      .from("payroll_runs")
      .select("id, period_start, period_end")
      .lte("period_start", run.period_end)
      .gte("period_end", run.period_start)
      .neq("id", run.id);
    if (overlapRuns?.length) {
      const runPeriod = new Map<string, { s: string; e: string }>();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const r of overlapRuns as any[])
        runPeriod.set(r.id, { s: r.period_start, e: r.period_end });
      const { data: oDetails } = await (client as any)
        .from("payroll_details")
        .select("id, run_id, rider_id")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .in(
          "run_id",
          (overlapRuns as any[]).map((r) => r.id),
        )
        .in("rider_id", [...dailyChargeRiderIds]);
      if (oDetails?.length) {
        const dMap = new Map<string, { runId: string; riderId: string }>();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const d of oDetails as any[]) dMap.set(d.id, { runId: d.run_id, riderId: d.rider_id });
        const { data: oDeds } = await (client as any)
          .from("payroll_deductions")
          .select("detail_id, installment_id")
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .in(
            "detail_id",
            (oDetails as any[]).map((d) => d.id),
          )
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
          for (
            const dt = new Date(`${p.s}T00:00:00Z`);
            dt <= end;
            dt.setUTCDate(dt.getUTCDate() + 1)
          ) {
            dates.add(dt.toISOString().slice(0, 10));
          }
        }
      }
    }
  }

  // Cicilan mode='fixed'/'monthly' eligible di beberapa client (client_ids) —
  // beda dari 'daily' yang dedup-nya per TANGGAL (dailyChargedDates di atas,
  // aman displit antar client), fixed/monthly itu lump-sum per periode.
  // siblingGrossByRiderClient (rider -> client -> gross periode ini) dipakai
  // allocateMultiClientDeduction buat waterfall-split per rider di loop bawah
  // — gross client lain yang KETAHUAN aktif periode ini (run-nya udah ada di
  // DB), query-based (bukan state di-mutate), idempotent kalau di-"Generate
  // Ulang" (hasil sama persis selama gross-nya belum berubah).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const multiClientInsts = ((installments ?? []) as any[]).filter(
    (i: any) =>
      (i.mode === "fixed" || i.mode === "monthly") &&
      Array.isArray(i.client_ids) &&
      i.client_ids.length > 0,
  );
  const siblingGrossByRiderClient = new Map<string, Map<string, number>>(); // riderId -> clientId -> gross_earning
  if (multiClientInsts.length > 0) {
    const allEligibleClientIds = [
      ...new Set(multiClientInsts.flatMap((i: any) => i.client_ids as string[])),
    ];
    // Overlap check (bukan exact match) — beda client bisa punya siklus
    // payroll beda cadence/hari-potong (mis. client A mingguan Senin-Minggu,
    // client B per-3-hari), jadi periode run-nya jarang PERSIS sama walau
    // overlap kalendernya penuh. Exact match bikin sibling run gak pernah
    // ketemu di kasus itu, dan cicilan yang sama ke-charge dobel di kedua
    // client buat rentang tanggal yang sama (lihat kasus rider Lucky Permana:
    // instalmen 4x ke-charge di client A DAN client B buat minggu yang sama,
    // gara-gara period client B gak identik PERSIS sama 2 run mingguan client
    // A walau overlap). Pola overlap ini sama persis kayak dedup sewa harian
    // (dailyChargedDates) di atas — disamain biar konsisten.
    const { data: siblingRuns } = await (client as any)
      .from("payroll_runs")
      .select("id, client_id")
      .lte("period_start", run.period_end)
      .gte("period_end", run.period_start)
      .in("client_id", allEligibleClientIds)
      .neq("id", run.id);
    const siblingRunIds = (siblingRuns ?? []).map((r: any) => r.id);
    const clientOfSiblingRun = new Map<string, string>(
      (siblingRuns ?? []).map((r: any) => [r.id as string, r.client_id as string]),
    );
    if (siblingRunIds.length > 0) {
      const { data: siblingDetails } = await (client as any)
        .from("payroll_details")
        .select("id, run_id, rider_id, gross_earning")
        .in("run_id", siblingRunIds);
      for (const d of (siblingDetails ?? []) as any[]) {
        const cid = clientOfSiblingRun.get(d.run_id);
        if (!cid) continue;
        const m = siblingGrossByRiderClient.get(d.rider_id) ?? new Map<string, number>();
        m.set(cid, Number(d.gross_earning || 0));
        siblingGrossByRiderClient.set(d.rider_id, m);
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
    // Cicilan bisa eligible di BEBERAPA client sekaligus (client_ids) — array
    // kosong/null fallback ke matchesClient single-value di atas (perilaku
    // lama, backward compatible). BPJS/auto-recurring (enrolledClient) TIDAK
    // ikut kena ini, masih pakai matchesClient biasa.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const matchesInstallmentClient = (i: any) => {
      if (run.client_id === null) return true;
      if (Array.isArray(i.client_ids) && i.client_ids.length > 0)
        return i.client_ids.includes(run.client_id);
      return matchesClient(i.client_id);
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rInstall = (installments ?? []).filter((i: any) => i.rider_id === rider.id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rInstallMatched = rInstall.filter((i: any) => matchesInstallmentClient(i));

    // Gross yang bakal dipakai buat ranking "client mana yang cukup" —
    // dihitung di sini (bukan nunggu variabel `gross` di bawah, yang baru ada
    // SETELAH continue-check) biar filtering ranking bisa kepakai sebelum
    // hasDailyCharge/hasMonthlyChargeDue/continue-check, konsisten di semua
    // downstream (dedItems dst pakai rInstallForRun yang SUDAH difilter).
    const projectedGross = deliveryFee + attendanceFee;
    // Waterfall-split per installment (allocateMultiClientDeduction) — gross
    // tiap client yang KETAHUAN aktif periode ini (diri sendiri + sibling
    // dari siblingGrossByRiderClient), diurut sesuai prioritas admin
    // (i.client_ids). Dihitung SEKALI di sini per installment, dipakai ulang
    // oleh filter rInstallForRun di bawah DAN dedItems (biar gak dihitung 2x
    // dengan kemungkinan hasil beda).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const multiClientCharge = new Map<string, MultiClientShare & { splitLegs: number }>();
    for (const i of rInstallMatched as any[]) {
      if (
        (i.mode !== "fixed" && i.mode !== "monthly") ||
        !Array.isArray(i.client_ids) ||
        i.client_ids.length === 0
      )
        continue; // 'daily' displit per-tanggal (dailyChargedDates), fixed/monthly single-client gak butuh split
      const baseAmount =
        i.mode === "monthly"
          ? Number(i.daily_rate || 0) * monthlyDueDays(i, run.period_end, closedCyclesByInst)
          : Number(i.per_period_amount || 0);
      const arrears = arrearsByInstallment.get(i.id) ?? 0;
      const grossByClient = new Map<string, number>();
      if (run.client_id) grossByClient.set(run.client_id, projectedGross);
      const siblingGross = siblingGrossByRiderClient.get(rider.id);
      if (siblingGross)
        for (const [cid, g] of siblingGross) if (cid !== run.client_id) grossByClient.set(cid, g);
      const shares = allocateMultiClientDeduction(
        arrears,
        baseAmount,
        i.client_ids as string[],
        grossByClient,
      );
      const mine = shares.find((s) => s.clientId === run.client_id);
      if (mine)
        multiClientCharge.set(i.id, {
          ...mine,
          splitLegs: shares.filter((s) => s.amount > 0).length,
        });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rInstallForRun = rInstallMatched.filter((i: any) => {
      if (
        (i.mode !== "fixed" && i.mode !== "monthly") ||
        !Array.isArray(i.client_ids) ||
        i.client_ids.length === 0
      )
        return true; // 'daily' displit per-tanggal (dailyChargedDates), fixed/monthly single-client gak butuh split
      return (multiClientCharge.get(i.id)?.amount ?? 0) > 0;
    });

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
    if (deliveryCount === 0 && attendanceFee === 0 && !hasDailyCharge && !hasMonthlyChargeDue)
      continue;

    const incentiveTotal = 0;
    const penalty = 0;
    const gross = deliveryFee + attendanceFee + incentiveTotal - penalty;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dedItems = rInstallForRun.map((i: any) => {
      // Multi-client (fixed/monthly, client_ids>0) udah dihitung waterfall-nya
      // di multiClientCharge di atas — pakai APA ADANYA (amount udah termasuk
      // porsi arrears-nya), jangan dihitung ulang di sini biar gak nyimpang
      // dari split yang udah ditentukan.
      const share = multiClientCharge.get(i.id);
      if (i.mode === "daily") {
        const arrears = arrearsByInstallment.get(i.id) ?? 0;
        const rate = Number(i.daily_rate || 0);
        const charged = dailyChargedDates.get(`${rider.id}|${i.id}`);
        // Tanggal PERSIS yang kena di periode ini (bukan cuma count) — biar
        // recap/slip bisa nunjukin hari mana yang beneran kepotong, bukan
        // cuma rentang periode run (yang bisa salah kalau sebagian harinya
        // udah kepotong run lain, lihat dailyChargedDates di atas).
        //
        // Mulai dari start_date cicilan ini KALAU itu lebih telat dari awal
        // periode run (bukan selalu run.period_start mentah) — sewa yang baru
        // mulai DI TENGAH periode (mis. unit baru diambil tgl 27, padahal
        // run-nya 24-30) sebelumnya tetap ke-charge dari tgl 1 periode (hari
        // SEBELUM unit-nya bahkan ada), bukan dari start_date. mode='monthly'
        // di monthlyDueDays di atas udah bener ngelakuin clamp yang sama
        // (effectiveStart) — daily ketinggalan, ini nyamain.
        const periodStart = new Date(`${run.period_start}T00:00:00Z`);
        const instStart = i.start_date ? new Date(`${i.start_date}T00:00:00Z`) : null;
        const loopStart = instStart && instStart > periodStart ? instStart : periodStart;
        const chargedDates: string[] = [];
        const end = new Date(`${run.period_end}T00:00:00Z`);
        for (const d = new Date(loopStart); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
          const iso = d.toISOString().slice(0, 10);
          if (!charged?.has(iso)) chargedDates.push(iso);
        }
        const days = chargedDates.length;
        return { amount: rate * days + arrears, days, arrears, chargedDates, splitLegs: 1 };
      }
      if (i.mode === "monthly") {
        const days = monthlyDueDays(i, run.period_end, closedCyclesByInst);
        if (share)
          return {
            amount: share.amount,
            days,
            arrears: share.arrearsPortion,
            chargedDates: [] as string[],
            splitLegs: share.splitLegs,
          };
        const arrears = arrearsByInstallment.get(i.id) ?? 0;
        return {
          amount: Number(i.daily_rate || 0) * days + arrears,
          days,
          arrears,
          chargedDates: [] as string[],
          splitLegs: 1,
        };
      }
      if (share)
        return {
          amount: share.amount,
          days: 0,
          arrears: share.arrearsPortion,
          chargedDates: [] as string[],
          splitLegs: share.splitLegs,
        };
      const arrears = arrearsByInstallment.get(i.id) ?? 0;
      return {
        amount: Number(i.per_period_amount || 0) + arrears,
        days: 0,
        arrears,
        chargedDates: [] as string[],
        splitLegs: 1,
      };
    });
    // charge_target='client_revenue' (mis. molis gratis buat rider, kita yang
    // nanggung sewanya) TIDAK ngurangin net_pay rider — biayanya kena di sisi
    // P&L client lewat molis-cost.ts, bukan di sini. Baris deduction tetap
    // dicatat di bawah (audit trail), cuma gak masuk ke installTotal.
    const installTotal = dedItems.reduce(
      (s, d, idx) =>
        s + ((rInstallForRun[idx] as any).charge_target === "client_revenue" ? 0 : d.amount),
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
      // closedOutMonths kosong = run ini gak nutup bulan manapun (numpang
      // lewat tengah bulan doang) — monthly_once nunggu run yang beneran
      // nutup bulannya, bukan asal kepotong di run pertama yang ketemu.
      if (
        t.trigger_frequency === "monthly_once" &&
        (closedOutMonths.length === 0 || chargedThisMonth.has(`${rider.id}|${t.id}`))
      )
        return false;
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
      id: detailId,
      run_id: run.id,
      rider_id: rider.id,
      client_id: run.client_id ?? rider.client_id,
      delivery_count: deliveryCount,
      delivery_fee: deliveryFee,
      attendance_fee: attendanceFee,
      incentive: incentiveTotal,
      penalty,
      gross_earning: gross,
      total_deduction: totalDed,
      net_pay: net,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rInstallForRun.forEach((ins: any, idx: number) => {
      const item = dedItems[idx];
      if (item.amount <= 0) return;
      const isClientRevenue =
        (ins.mode === "daily" || ins.mode === "monthly") && ins.charge_target === "client_revenue";
      const revenueNote = isClientRevenue
        ? " (ditanggung revenue client, tidak potong net pay)"
        : "";
      const cycleNote =
        ins.mode === "monthly" ? ` (potong per siklus tgl ${ins.cycle_start_day || 25})` : "";
      const arrearsNote =
        item.arrears > 0 ? ` + tunggakan Rp${item.arrears.toLocaleString("id-ID")}` : "";
      // Tanggal PERSIS yang kepotong (mode daily) — bukan cuma rentang periode
      // run, biar keliatan kalau sebagian harinya udah kepotong run lain (lihat
      // dailyChargedDates) dan Recap/slip gak nunjukin rentang yang menyesatkan.
      const datesNote =
        ins.mode === "daily" && item.chargedDates.length > 0
          ? ` (tgl ${item.chargedDates.map((d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`).join(", ")})`
          : "";
      // Cicilan/sewa yang kena waterfall-split (allocateMultiClientDeduction,
      // >1 client sama-sama nanggung periode ini) — ditandain di deskripsi
      // biar keliatan angka ini BUKAN keseluruhan potongan periode itu, sisanya
      // ada di slip client lain (lihat splitLegs di dedItems).
      const splitNote = item.splitLegs > 1 ? " (dibagi dgn client lain)" : "";
      const description =
        ins.mode === "daily" || ins.mode === "monthly"
          ? `Sewa ${item.days} hari x Rp${Number(ins.daily_rate || 0).toLocaleString("id-ID")}` +
            datesNote +
            arrearsNote +
            cycleNote +
            revenueNote +
            splitNote
          : ins.ewa_request_code
            ? `EWA ${ins.ewa_request_code}` + arrearsNote + splitNote
            : `Cicilan ${ins.installments_paid + 1}/${ins.installment_count}` +
              arrearsNote +
              splitNote;
      deductionsToInsert.push({
        detail_id: detailId,
        deduction_type_id: ins.deduction_type_id,
        installment_id: ins.id,
        kasbon_recipient_id: ins.kasbon_recipient_id ?? null,
        description,
        amount: isClientRevenue ? 0 : item.amount,
      });
    });
    for (const x of autoItems) {
      const t = x.t;
      if (x.amount <= 0) continue;
      const description =
        x.arrears > 0 ? `${t.name} + tunggakan Rp${x.arrears.toLocaleString("id-ID")}` : t.name;
      deductionsToInsert.push({
        detail_id: detailId,
        deduction_type_id: t.id,
        installment_id: null,
        description,
        amount: x.amount,
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
  let q = (client as any)
    .from("payroll_runs")
    .select("id, client_id, period_start, period_end, status")
    .eq("period_start", opts.periodStart)
    .eq("period_end", opts.periodEnd)
    .neq("status", "published");
  q = opts.clientId ? q.eq("client_id", opts.clientId) : q.is("client_id", null);
  const { data: existing, error: findErr } = await q.limit(1).maybeSingle();
  if (findErr) throw findErr;
  if (existing) return existing;

  const name = `Payroll ${opts.clientName} periode ${opts.periodStart} → ${opts.periodEnd}`;
  const { data: created, error: createErr } = await (client as any)
    .from("payroll_runs")
    .insert({
      name,
      period_type: "weekly",
      period_start: opts.periodStart,
      period_end: opts.periodEnd,
      client_id: opts.clientId,
    })
    .select("id, client_id, period_start, period_end, status")
    .single();
  if (createErr) throw createErr;
  return created;
}
