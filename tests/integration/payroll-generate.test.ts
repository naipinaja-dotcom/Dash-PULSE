import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock query builder in-memory, keyed by TABLE NAME (bukan FIFO queue) —
// payroll-generate.ts nembak banyak query paralel/kondisional (delete lalu
// Promise.all select, lalu select lagi tergantung hasil sebelumnya), jadi
// urutan gak bisa ditebak; filter beneran diterapin di sini biar logic
// asli (join manual, dedup bulanan, dst) yang jalan, bukan hasil di-mock.
const mock = vi.hoisted(() => {
  const tables: Record<string, any[]> = {};
  const inserted: Record<string, any[]> = {};

  function applyFilters(rows: any[], filters: { op: string; col: string; val: unknown }[]) {
    return rows.filter((r) =>
      filters.every((f) => {
        const v = r[f.col];
        if (f.op === "eq") return v === f.val;
        if (f.op === "in") return (f.val as unknown[]).includes(v);
        if (f.op === "gte") return v >= (f.val as string);
        if (f.op === "lte") return v <= (f.val as string);
        if (f.op === "neq") return v !== f.val;
        if (f.op === "is") return v === f.val;
        if (f.op === "not") return v !== f.val;
        return true;
      }),
    );
  }

  function makeBuilder(table: string) {
    const q: any = { verb: "select", filters: [] };
    const b: any = {
      select() {
        return b;
      },
      insert(rows: any[]) {
        q.verb = "insert";
        q.rows = Array.isArray(rows) ? rows : [rows];
        return b;
      },
      delete() {
        q.verb = "delete";
        return b;
      },
      eq(col: string, val: unknown) {
        q.filters.push({ op: "eq", col, val });
        return b;
      },
      in(col: string, val: unknown) {
        q.filters.push({ op: "in", col, val });
        return b;
      },
      gte(col: string, val: unknown) {
        q.filters.push({ op: "gte", col, val });
        return b;
      },
      lte(col: string, val: unknown) {
        q.filters.push({ op: "lte", col, val });
        return b;
      },
      neq(col: string, val: unknown) {
        q.filters.push({ op: "neq", col, val });
        return b;
      },
      is(col: string, val: unknown) {
        q.filters.push({ op: "is", col, val });
        return b;
      },
      not(col: string, _operator: string, val: unknown) {
        q.filters.push({ op: "not", col, val });
        return b;
      },
      range() {
        return b;
      },
      single() {
        q.single = true;
        return b;
      },
      maybeSingle() {
        q.single = true;
        return b;
      },
      then(resolve: (v: unknown) => void) {
        if (q.verb === "insert") {
          inserted[table] = [...(inserted[table] ?? []), ...q.rows];
          resolve({ data: q.rows, error: null });
        } else if (q.verb === "delete") {
          resolve({ data: null, error: null });
        } else {
          const rows = applyFilters(tables[table] ?? [], q.filters);
          resolve({ data: q.single ? (rows[0] ?? null) : rows, error: null });
        }
      },
    };
    return b;
  }

  // Mock RPC regenerate_payroll_details — mirror perilaku function Postgres
  // asli (lihat migration atomic_regenerate_payroll_details): delete lama,
  // insert baru, dalam "satu langkah" (gak ada window kegagalan buat di-tes
  // di sini — atomicity-nya ada di sisi DB, bukan di mock).
  function rpc(fn: string, params: any) {
    return Promise.resolve().then(() => {
      if (fn !== "regenerate_payroll_details") throw new Error(`unmocked rpc: ${fn}`);
      const { p_run_id, p_details, p_deductions } = params;
      tables.payroll_details = (tables.payroll_details ?? []).filter((d) => d.run_id !== p_run_id);
      inserted.payroll_details = [...(inserted.payroll_details ?? []), ...p_details];
      inserted.payroll_deductions = [...(inserted.payroll_deductions ?? []), ...p_deductions];
      return { data: null, error: null };
    });
  }

  return { client: { from: (t: string) => makeBuilder(t), rpc }, tables, inserted };
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: mock.client }));

import {
  generatePayrollDetails,
  computeInstallmentAdvance,
  type PayrollRunLite,
} from "@/lib/payroll-generate";

function reset() {
  for (const k of Object.keys(mock.tables)) delete mock.tables[k];
  for (const k of Object.keys(mock.inserted)) delete mock.inserted[k];
}

const run = (over: Partial<PayrollRunLite> = {}): PayrollRunLite => ({
  id: "run-1",
  client_id: "client-1",
  period_start: "2026-07-21",
  period_end: "2026-07-23", // Selasa-Kamis, 3 hari
  ...over,
});

describe("generatePayrollDetails — deduction (mocked Supabase)", () => {
  beforeEach(reset);

  it("mode='daily' (sewa): rider tetap dibikinin baris walau nol delivery, dipotong daily_rate x jumlah hari periode", () => {
    mock.tables.riders = [
      { id: "r1", client_id: "client-1", employee_id: "MTR1", full_name: "Budi" },
    ];
    mock.tables.delivery_records = []; // Budi gak jalan sama sekali periode ini
    mock.tables.attendance_logs = [];
    mock.tables.rider_installments = [
      {
        id: "ins1",
        rider_id: "r1",
        deduction_type_id: "sewa",
        mode: "daily",
        daily_rate: 38000,
        active: true,
        next_deduction_date: "2026-01-01",
        installments_paid: 0,
        installment_count: null,
        per_period_amount: null,
      },
    ];
    mock.tables.deduction_types = [];

    return generatePayrollDetails(run(), mock.client as any).then(({ detailCount }) => {
      expect(detailCount).toBe(1);
      const detail = mock.inserted.payroll_details[0];
      expect(detail.gross_earning).toBe(0);
      expect(detail.total_deduction).toBe(38000 * 3); // 3 hari kalender (Sel-Kam)
      expect(detail.net_pay).toBe(0); // floor di 0, gak minus
      const ded = mock.inserted.payroll_deductions[0];
      expect(ded.amount).toBe(114000);
      expect(ded.description).toContain("3 hari");
    });
  });

  it("mode='daily' TIDAK dobel-tagih di run client lain (bukan 'rumah' rider itu)", () => {
    mock.tables.riders = [
      { id: "r1", client_id: "client-1", employee_id: "MTR1", full_name: "Budi" },
    ];
    mock.tables.delivery_records = [];
    mock.tables.attendance_logs = [];
    mock.tables.rider_installments = [
      {
        id: "ins1",
        rider_id: "r1",
        deduction_type_id: "sewa",
        mode: "daily",
        daily_rate: 38000,
        active: true,
        next_deduction_date: "2026-01-01",
        installments_paid: 0,
        installment_count: null,
        per_period_amount: null,
      },
    ];
    mock.tables.deduction_types = [];

    // run ini buat "client-2" — bukan rumah Budi (client-1) — jadi Budi
    // gak boleh muncul sama sekali di run ini.
    return generatePayrollDetails(run({ client_id: "client-2" }), mock.client as any).then(
      ({ detailCount }) => {
        expect(detailCount).toBe(0);
      },
    );
  });

  it("mode='fixed' (cicilan): amount flat per_period_amount, gak dikali hari", () => {
    mock.tables.riders = [
      { id: "r1", client_id: "client-1", employee_id: "MTR1", full_name: "Budi" },
    ];
    mock.tables.delivery_records = [
      {
        rider_id: "r1",
        driver_code: null,
        fee: 100000,
        delivery_date: "2026-07-22",
        client_id: "client-1",
        status: "COMPLETED",
      },
    ];
    mock.tables.attendance_logs = [];
    mock.tables.rider_installments = [
      {
        id: "ins1",
        rider_id: "r1",
        deduction_type_id: "rusak",
        mode: "fixed",
        daily_rate: null,
        active: true,
        next_deduction_date: "2026-01-01",
        installments_paid: 1,
        installment_count: 3,
        per_period_amount: 50000,
      },
    ];
    mock.tables.deduction_types = [];

    return generatePayrollDetails(run(), mock.client as any).then(() => {
      const ded = mock.inserted.payroll_deductions[0];
      expect(ded.amount).toBe(50000);
      expect(ded.description).toBe("Cicilan 2/3");
    });
  });

  it("delivery_records status != COMPLETED (FAILED/PENDING_PICKUP) TIDAK ikut kehitung ke gaji", () => {
    mock.tables.riders = [
      { id: "r1", client_id: "client-1", employee_id: "MTR1", full_name: "Budi" },
    ];
    mock.tables.delivery_records = [
      {
        rider_id: "r1",
        driver_code: null,
        fee: 100000,
        delivery_date: "2026-07-22",
        client_id: "client-1",
        status: "COMPLETED",
      },
      {
        rider_id: "r1",
        driver_code: null,
        fee: 50000,
        delivery_date: "2026-07-22",
        client_id: "client-1",
        status: "FAILED",
      },
      {
        rider_id: "r1",
        driver_code: null,
        fee: 50000,
        delivery_date: "2026-07-22",
        client_id: "client-1",
        status: "PENDING_PICKUP",
      },
    ];
    mock.tables.attendance_logs = [];
    mock.tables.rider_installments = [];
    mock.tables.deduction_types = [];

    return generatePayrollDetails(run(), mock.client as any).then(() => {
      const detail = mock.inserted.payroll_details[0];
      expect(detail.delivery_count).toBe(1); // cuma yang COMPLETED
      expect(detail.gross_earning).toBe(100000);
    });
  });

  it("auto_recurring trigger_frequency='monthly_once' (BPJS): cuma kepotong 1x per bulan, lintas run/client manapun", () => {
    mock.tables.riders = [
      { id: "r1", client_id: "client-1", employee_id: "MTR1", full_name: "Budi" },
    ];
    mock.tables.delivery_records = [
      {
        rider_id: "r1",
        driver_code: null,
        fee: 100000,
        delivery_date: "2026-07-22",
        client_id: "client-1",
        status: "COMPLETED",
      },
    ];
    mock.tables.attendance_logs = [];
    mock.tables.rider_installments = [];
    mock.tables.deduction_types = [
      {
        id: "bpjs",
        name: "BPJS JKK",
        recurring_amount: 16800,
        active: true,
        auto_recurring: true,
        trigger_frequency: "monthly_once", applies_to_all: true,
      },
    ];
    // Udah pernah kepotong BPJS bulan ini (Juli 2026) di run LAIN (client-9, periode beda)
    mock.tables.payroll_runs = [{ id: "old-run", period_end: "2026-07-10" }];
    mock.tables.payroll_details = [{ id: "old-detail", run_id: "old-run", rider_id: "r1" }];
    mock.tables.payroll_deductions = [{ detail_id: "old-detail", deduction_type_id: "bpjs" }];

    return generatePayrollDetails(run(), mock.client as any).then(() => {
      const deds = mock.inserted.payroll_deductions ?? [];
      expect(deds.find((d) => d.deduction_type_id === "bpjs")).toBeUndefined();
    });
  });

  it("auto_recurring trigger_frequency='monthly_once' (BPJS): TETAP kepotong kalau belum pernah bulan ini", () => {
    mock.tables.riders = [
      { id: "r1", client_id: "client-1", employee_id: "MTR1", full_name: "Budi" },
    ];
    mock.tables.delivery_records = [
      {
        rider_id: "r1",
        driver_code: null,
        fee: 100000,
        delivery_date: "2026-07-22",
        client_id: "client-1",
        status: "COMPLETED",
      },
    ];
    mock.tables.attendance_logs = [];
    mock.tables.rider_installments = [];
    mock.tables.deduction_types = [
      {
        id: "bpjs",
        name: "BPJS JKK",
        recurring_amount: 16800,
        active: true,
        auto_recurring: true,
        trigger_frequency: "monthly_once", applies_to_all: true,
      },
    ];
    mock.tables.payroll_runs = [];
    mock.tables.payroll_details = [];
    mock.tables.payroll_deductions = [];

    return generatePayrollDetails(run(), mock.client as any).then(() => {
      const ded = mock.inserted.payroll_deductions.find((d: any) => d.deduction_type_id === "bpjs");
      expect(ded?.amount).toBe(16800);
    });
  });

  it("auto_recurring trigger_frequency='every_payroll_run' (default): kepotong tiap run, gak di-dedup bulanan", () => {
    mock.tables.riders = [
      { id: "r1", client_id: "client-1", employee_id: "MTR1", full_name: "Budi" },
    ];
    mock.tables.delivery_records = [
      {
        rider_id: "r1",
        driver_code: null,
        fee: 100000,
        delivery_date: "2026-07-22",
        client_id: "client-1",
        status: "COMPLETED",
      },
    ];
    mock.tables.attendance_logs = [];
    mock.tables.rider_installments = [];
    mock.tables.deduction_types = [
      {
        id: "adm",
        name: "Biaya Admin",
        recurring_amount: 2500,
        active: true,
        auto_recurring: true,
        trigger_frequency: "every_payroll_run", applies_to_all: true,
      },
    ];
    // Walau udah kepotong ADM di run lain bulan ini, every_payroll_run tetap kepotong lagi.
    mock.tables.payroll_runs = [{ id: "old-run", period_end: "2026-07-10" }];
    mock.tables.payroll_details = [{ id: "old-detail", run_id: "old-run", rider_id: "r1" }];
    mock.tables.payroll_deductions = [{ detail_id: "old-detail", deduction_type_id: "adm" }];

    return generatePayrollDetails(run(), mock.client as any).then(() => {
      const ded = mock.inserted.payroll_deductions.find((d: any) => d.deduction_type_id === "adm");
      expect(ded?.amount).toBe(2500);
    });
  });

  it("auto_recurring TETAP kepotong walau gross rider di client ini nol (rider ke-discover lewat cicilan daily, bukan delivery)", () => {
    mock.tables.riders = [
      { id: "r1", client_id: "client-1", employee_id: "MTR1", full_name: "Budi" },
    ];
    mock.tables.delivery_records = []; // nol delivery di client ini periode ini
    mock.tables.attendance_logs = [];
    mock.tables.rider_installments = [
      {
        id: "ins1",
        rider_id: "r1",
        deduction_type_id: "sewa",
        mode: "daily",
        daily_rate: 0,
        active: true,
        next_deduction_date: "2026-01-01",
        installments_paid: 0,
        installment_count: null,
        per_period_amount: null,
      },
    ];
    mock.tables.deduction_types = [
      {
        id: "adm",
        name: "Biaya Admin",
        recurring_amount: 2500,
        active: true,
        auto_recurring: true,
        trigger_frequency: "every_payroll_run", applies_to_all: true,
      },
    ];
    mock.tables.payroll_runs = [];
    mock.tables.payroll_details = [];
    mock.tables.payroll_deductions = [];

    return generatePayrollDetails(run(), mock.client as any).then(() => {
      const detail = mock.inserted.payroll_details[0];
      expect(detail.gross_earning).toBe(0);
      const ded = mock.inserted.payroll_deductions.find((d: any) => d.deduction_type_id === "adm");
      expect(ded?.amount).toBe(2500); // dulu di-skip gara-gara gate `gross > 0`
    });
  });
});

describe("computeInstallmentAdvance (publish — maju/nggaknya progress cicilan)", () => {
  it("mode='fixed': maju & selesai begitu paid_amount menutup potongan", () => {
    const ins = { mode: "fixed", installments_paid: 2, installment_count: 3 };
    expect(computeInstallmentAdvance(ins, true)).toEqual({ installments_paid: 3, active: false });
  });

  it("mode='fixed': maju tapi masih aktif kalau belum mencapai installment_count", () => {
    const ins = { mode: "fixed", installments_paid: 0, installment_count: 3 };
    expect(computeInstallmentAdvance(ins, true)).toEqual({ installments_paid: 1, active: true });
  });

  it("mode='monthly': TIDAK PERNAH dianggap selesai (dulu mati abis publish 1x gara-gara installment_count null)", () => {
    const ins = { mode: "monthly", installments_paid: 0, installment_count: null };
    expect(computeInstallmentAdvance(ins, true)).toBeNull();
  });

  it("mode='daily': gak pernah disentuh sama sekali", () => {
    const ins = { mode: "daily", installments_paid: 5, installment_count: null };
    expect(computeInstallmentAdvance(ins, true)).toBeNull();
  });

  it("mode='fixed' dengan shortfall (gross < total_deduction, belum di-netting): JANGAN maju, ke-tagih lagi run berikutnya", () => {
    const ins = { mode: "fixed", installments_paid: 0, installment_count: 3 };
    expect(computeInstallmentAdvance(ins, false)).toBeNull();
  });
});
