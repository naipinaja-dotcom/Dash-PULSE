import { describe, it, expect } from "vitest";
import { monthsClosedOutBy, allocateMultiClientDeduction } from "@/lib/payroll-generate";

// Regression: BPJS Alfagift kepotong 2x pas periode mingguan nabrak
// pergantian bulan (24-30 Agu lalu 31 Agu-6 Sep dianggap 2 bulan beda).
// monthsClosedOutBy nentuin bulan mana yang BENERAN "ditutup" sama sebuah
// periode (ngelewatin tgl>=28), dipakai buat dedup "monthly_once" (BPJS)
// di generatePayrollDetails.
describe("monthsClosedOutBy", () => {
  it("run yang seluruhnya di tengah bulan gak nutup bulan manapun", () => {
    expect(monthsClosedOutBy("2026-08-01", "2026-08-07")).toEqual([]);
    expect(monthsClosedOutBy("2026-08-24", "2026-08-27")).toEqual([]);
  });

  it("run yang nyampe tgl>=28 nutup bulan itu", () => {
    expect(monthsClosedOutBy("2026-08-24", "2026-08-30")).toEqual(["2026-08"]);
  });

  it("run yang numpang lewat pergantian bulan nutup bulan LAMA, bukan bulan baru (kasus Alfagift)", () => {
    expect(monthsClosedOutBy("2026-08-31", "2026-09-06")).toEqual(["2026-08"]);
  });

  it("run bulan Februari (28 hari) tetap ke-detect", () => {
    expect(monthsClosedOutBy("2026-02-23", "2026-03-01")).toEqual(["2026-02"]);
  });

  it("run yang bener2 mulai tgl 1 bulan baru gak nutup bulan lama", () => {
    expect(monthsClosedOutBy("2026-09-01", "2026-09-07")).toEqual([]);
  });

  it("periode panjang (>1 bulan) bisa nutup lebih dari 1 bulan", () => {
    expect(monthsClosedOutBy("2026-07-25", "2026-08-29")).toEqual(["2026-07", "2026-08"]);
  });
});

// Regression: cicilan multi-client (rider_installments.client_ids) pernah
// dobel-charge (kasus rider Lucky Permana/Nahrowi — dedup sibling run pakai
// exact period match, gagal ngenalin client lain yang siklus payroll-nya
// beda cadence). Begitu dedup-nya dibenerin (overlap check), model lama
// (winner-take-all) masih nyisain uang di meja kalau kedua client
// SAMA-SAMA gak cukup sendiri-sendiri tapi gabungannya cukup — makanya
// diganti waterfall split (allocateMultiClientDeduction).
describe("allocateMultiClientDeduction", () => {
  it("1 client aktif doang (baru run ini) -> charge penuh di situ", () => {
    const shares = allocateMultiClientDeduction(0, 62_500, ["A", "B"], new Map([["A", 200_000]]));
    expect(shares).toEqual([{ clientId: "A", amount: 62_500, arrearsPortion: 0 }]);
  });

  it("client prioritas #1 cukup sendirian -> dia nanggung semua, client #2 nol", () => {
    const shares = allocateMultiClientDeduction(
      0,
      62_500,
      ["A", "B"],
      new Map([
        ["A", 200_000],
        ["B", 100_000],
      ]),
    );
    expect(shares).toEqual([
      { clientId: "A", amount: 62_500, arrearsPortion: 0 },
      { clientId: "B", amount: 0, arrearsPortion: 0 },
    ]);
  });

  it("kedua client sama-sama gak cukup sendiri, gabungannya cukup -> displit, bukan dobel/nol", () => {
    // Kasus nyata: Ridwan/Fery — client A gross 40rb, client B gross 30rb,
    // potongan 62.5rb. Kombinasi 70rb > 62.5rb, harusnya lunas periode ini,
    // BUKAN nyisa jadi tunggakan padahal duitnya ada.
    const shares = allocateMultiClientDeduction(
      0,
      62_500,
      ["A", "B"],
      new Map([
        ["A", 40_000],
        ["B", 30_000],
      ]),
    );
    expect(shares).toEqual([
      { clientId: "A", amount: 40_000, arrearsPortion: 0 },
      { clientId: "B", amount: 22_500, arrearsPortion: 0 },
    ]);
    expect(shares.reduce((s, x) => s + x.amount, 0)).toBe(62_500);
  });

  it("gabungan gross TETAP gak cukup -> sisa yang beneran gak collectible tetap DITAGIH (bukan diputihin), biar ke-carry jadi tunggakan next cycle", () => {
    const shares = allocateMultiClientDeduction(
      0,
      62_500,
      ["A", "B"],
      new Map([
        ["A", 10_000],
        ["B", 5_000],
      ]),
    );
    // Jumlah total HARUS tetap 62_500 (bukan cuma 15_000) walau gross gabungan
    // gak nutup — client TERAKHIR (B) nanggung sisa yang gak collectible,
    // biar getCarriedArrears bisa nagih lagi next cycle (bukan hilang).
    expect(shares.reduce((s, x) => s + x.amount, 0)).toBe(62_500);
    expect(shares[0]).toEqual({ clientId: "A", amount: 10_000, arrearsPortion: 0 });
    expect(shares[1]).toEqual({ clientId: "B", amount: 52_500, arrearsPortion: 0 });
  });

  it("tunggakan (arrears) dikonsumsi DULUAN sebelum base amount, lintas leg", () => {
    // arrears 20rb + base 50rb = 70rb total. Client A cuma cukup buat nutup
    // arrears (20rb), sisanya (base 50rb) jatuh ke client B.
    const shares = allocateMultiClientDeduction(
      20_000,
      50_000,
      ["A", "B"],
      new Map([
        ["A", 20_000],
        ["B", 100_000],
      ]),
    );
    expect(shares).toEqual([
      { clientId: "A", amount: 20_000, arrearsPortion: 20_000 },
      { clientId: "B", amount: 50_000, arrearsPortion: 0 },
    ]);
  });

  it("client yang belum aktif periode ini (gak ada di grossByClient) dilewatin, gak dianggap gross 0", () => {
    const shares = allocateMultiClientDeduction(
      0,
      62_500,
      ["A", "B", "C"],
      new Map([["C", 200_000]]), // A & B belum digenerate periode ini
    );
    expect(shares).toEqual([{ clientId: "C", amount: 62_500, arrearsPortion: 0 }]);
  });

  it("gak ada client manapun yang aktif -> kosong (gak crash)", () => {
    expect(allocateMultiClientDeduction(0, 62_500, ["A", "B"], new Map())).toEqual([]);
  });
});
