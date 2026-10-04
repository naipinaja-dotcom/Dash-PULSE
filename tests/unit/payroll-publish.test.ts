import { describe, it, expect, beforeEach } from "vitest";
import { publishPayrollDetails, maybeCompleteRunPublish } from "@/lib/payroll-publish";

// Minimal in-memory fake Supabase client — keyed by table name, supports
// just the chain shapes payroll-publish.ts actually uses (select/eq/in/
// order/limit/maybeSingle/single, update, upsert). Modeled on the same
// query-builder-as-thenable pattern as tests/integration/payroll-generate.test.ts,
// extended with update/upsert since publish() needs to write, not just read.
function makeFakeClient(tables: Record<string, any[]>) {
  function applyFilters(rows: any[], filters: { op: string; col: string; val: unknown }[]) {
    return rows.filter((r) =>
      filters.every((f) => {
        const v = r[f.col];
        if (f.op === "eq") return v === f.val;
        if (f.op === "in") return (f.val as unknown[]).includes(v);
        return true;
      }),
    );
  }
  function makeBuilder(table: string) {
    const q: any = { verb: "select", filters: [], order: null };
    const b: any = {
      select() {
        return b;
      },
      update(payload: any) {
        q.verb = "update";
        q.payload = payload;
        return b;
      },
      upsert(rows: any[]) {
        q.verb = "upsert";
        q.rows = Array.isArray(rows) ? rows : [rows];
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
      order(col: string, opts: { ascending: boolean }) {
        q.order = { col, ascending: opts.ascending };
        return b;
      },
      limit() {
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
        tables[table] = tables[table] ?? [];
        if (q.verb === "update") {
          const matched = applyFilters(tables[table], q.filters);
          for (const row of matched) Object.assign(row, q.payload);
          resolve({ data: matched, error: null });
          return;
        }
        if (q.verb === "upsert") {
          const onConflictKey = "detail_id";
          for (const row of q.rows) {
            const existing = tables[table].find(
              (r: any) => r[onConflictKey] === row[onConflictKey],
            );
            if (existing) Object.assign(existing, row);
            else tables[table].push({ ...row });
          }
          resolve({ data: q.rows, error: null });
          return;
        }
        let rows = applyFilters(tables[table], q.filters);
        if (q.order) {
          rows = [...rows].sort((a, b2) =>
            q.order.ascending ? a[q.order.col] - b2[q.order.col] : b2[q.order.col] - a[q.order.col],
          );
        }
        resolve({ data: q.single ? (rows[0] ?? null) : rows, error: null });
      },
    };
    return b;
  }
  return { from: (t: string) => makeBuilder(t) };
}

function detail(over: Partial<any> = {}) {
  return {
    id: `d-${Math.random().toString(36).slice(2, 8)}`,
    run_id: "run-1",
    client_id: "client-a",
    rider_id: "rider-1",
    gross_earning: 100000,
    ...over,
  };
}

describe("publishPayrollDetails", () => {
  let tables: Record<string, any[]>;
  let client: ReturnType<typeof makeFakeClient>;

  beforeEach(() => {
    tables = {
      payroll_details: [],
      payslips: [],
      payroll_deductions: [],
      rider_installments: [],
      spend_control_pushes: [],
      payroll_runs: [
        { id: "run-1", status: "finalized", period_start: "2026-09-01", period_end: "2026-09-07" },
      ],
    };
    client = makeFakeClient(tables);
  });

  it("bikin payslip buat semua detail client itu di run ini", async () => {
    tables.payroll_details.push(detail({ id: "d1" }), detail({ id: "d2" }));

    const res = await publishPayrollDetails(client, {
      runId: "run-1",
      clientId: "client-a",
      actorUserId: "user-1",
    });

    expect(res.slipCount).toBe(2);
    expect(tables.payslips.map((s: any) => s.detail_id).sort()).toEqual(["d1", "d2"]);
  });

  it("idempoten — dipanggil 2x gak bikin payslip dobel atau majuin cicilan 2x", async () => {
    tables.payroll_details.push(detail({ id: "d1", gross_earning: 50000 }));
    tables.rider_installments.push({
      id: "ins1",
      mode: "fixed",
      installments_paid: 0,
      installment_count: 5,
      client_ids: ["client-a"],
    });
    tables.payroll_deductions.push({
      id: "ded1",
      detail_id: "d1",
      installment_id: "ins1",
      amount: 50000,
      deduction_types: { code: "KUOTA" },
    });

    const first = await publishPayrollDetails(client, {
      runId: "run-1",
      clientId: "client-a",
      actorUserId: null,
    });
    expect(first.slipCount).toBe(1);
    expect(tables.rider_installments[0].installments_paid).toBe(1);

    const second = await publishPayrollDetails(client, {
      runId: "run-1",
      clientId: "client-a",
      actorUserId: null,
    });
    expect(second.slipCount).toBe(0);
    // Dipanggil lagi TIDAK majuin cicilan utk kedua kalinya.
    expect(tables.rider_installments[0].installments_paid).toBe(1);
    expect(tables.payslips.length).toBe(1);
  });

  it("EWA diprioritaskan paling dulu: gross yang kurang jatuh ke potongan lain, bukan EWA", async () => {
    tables.payroll_details.push(detail({ id: "d1", gross_earning: 50000 }));
    tables.payroll_deductions.push(
      { id: "adm", detail_id: "d1", installment_id: null, amount: 30000, deduction_types: { code: "ADM" } },
      { id: "ewa", detail_id: "d1", installment_id: null, amount: 40000, deduction_types: { code: "EWA" } },
    );

    await publishPayrollDetails(client, { runId: "run-1", clientId: "client-a", actorUserId: null });

    const paid = (id: string) => tables.payroll_deductions.find((d: any) => d.id === id).paid_amount;
    expect(paid("ewa")).toBe(40000); // EWA lunas dulu
    expect(paid("adm")).toBe(10000); // sisa gross 10.000, sisanya jadi tunggakan
  });
});

describe("maybeCompleteRunPublish", () => {
  let tables: Record<string, any[]>;
  let client: ReturnType<typeof makeFakeClient>;

  beforeEach(() => {
    tables = {
      payroll_details: [
        detail({ id: "da", client_id: "client-a" }),
        detail({ id: "db", client_id: "client-b" }),
      ],
      payslips: [],
      payroll_deductions: [],
      rider_installments: [],
      spend_control_pushes: [],
      payroll_runs: [{ id: "run-1", status: "finalized" }],
    };
    client = makeFakeClient(tables);
  });

  it("run dengan 2 client — belum published selama SALAH SATU client belum ke-publish", async () => {
    await publishPayrollDetails(client, {
      runId: "run-1",
      clientId: "client-a",
      actorUserId: null,
    });

    const flipped = await maybeCompleteRunPublish(client, "run-1");
    expect(flipped).toBe(false);
    expect(tables.payroll_runs[0].status).toBe("finalized");
  });

  it("run fully published begitu SEMUA client udah ke-publish", async () => {
    await publishPayrollDetails(client, {
      runId: "run-1",
      clientId: "client-a",
      actorUserId: null,
    });
    await publishPayrollDetails(client, {
      runId: "run-1",
      clientId: "client-b",
      actorUserId: null,
    });

    const flipped = await maybeCompleteRunPublish(client, "run-1", "user-1");
    expect(flipped).toBe(true);
    expect(tables.payroll_runs[0].status).toBe("published");
    expect(tables.payroll_runs[0].published_by).toBe("user-1");
  });

  it("gak flip lagi kalau run udah published duluan", async () => {
    tables.payroll_runs[0].status = "published";
    const flipped = await maybeCompleteRunPublish(client, "run-1", "user-2");
    expect(flipped).toBe(false);
  });
});
