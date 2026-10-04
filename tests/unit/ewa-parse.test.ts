import { describe, it, expect } from "vitest";
import { parseEwaLines } from "@/lib/ewa-parse";

const riders = [
  { id: "r1", employee_id: "MTR0001", full_name: "Budi" },
  { id: "r2", employee_id: "MTR0002", full_name: "Sari" },
];

describe("parseEwaLines", () => {
  it("baris valid dengan tab (paste dari Sheets)", () => {
    const { rows, errors } = parseEwaLines("MTR0001\t257.100\nMTR0002\t100.000", riders);
    expect(errors).toEqual([]);
    expect(rows.map((r) => [r.riderId, r.amount])).toEqual([
      ["r1", 257100],
      ["r2", 100000],
    ]);
  });

  it("pemisah koma, titik-koma, spasi, dan awalan Rp", () => {
    const { rows, errors } = parseEwaLines("MTR0001,50000\nMTR0002;Rp 75.000\nmtr0001   1", riders);
    expect(rows.map((r) => r.amount)).toEqual([50000, 75000]);
    // baris ke-3: kode huruf kecil tetap cocok, tapi rider yang sama sudah ada = dobel
    expect(errors).toHaveLength(1);
    expect(errors[0].reason).toContain("dobel");
  });

  it("kode mitra tidak ditemukan", () => {
    const { rows, errors } = parseEwaLines("MTR9999 50000", riders);
    expect(rows).toEqual([]);
    expect(errors[0]).toMatchObject({ line: 1, reason: expect.stringContaining("tidak ditemukan") });
  });

  it("nominal kosong atau nol ditolak", () => {
    const { errors } = parseEwaLines("MTR0001 0\nMTR0002", riders);
    expect(errors.map((e) => e.line)).toEqual([1, 2]);
  });

  it("baris kosong diabaikan dan nomor baris tetap sesuai input", () => {
    const { rows, errors } = parseEwaLines("\nMTR0001 1000\n\nMTR9999 5", riders);
    expect(rows[0].line).toBe(2);
    expect(errors[0].line).toBe(4);
  });
});
