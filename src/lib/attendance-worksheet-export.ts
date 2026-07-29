// Detail/Ringkasan sheet builders KHUSUS run attendance-only, mengikuti
// format sheet referensi ops (Pitstop Name, Shift, breakdown Total Fee vs
// Incentive Ontime terpisah) — dipisah dari finance-worksheet.tsx supaya
// file itu gak numpuk di atas batas 500 baris (lihat CLAUDE.md), sama
// seperti pola src/components/deduction-summary.tsx.
import type { Cell } from "./finance-export";

export type DelivDetail = {
  date: string;
  km: number | null;
  kg: number | null;
  type: string | null;
  district: string | null;
  fee: number;
};

// shiftLabel/base/overtime/incentiveAmt di-replay dari config skema attendance
// yang berlaku SEKARANG (lihat findShiftFor/calcAttendanceComponent di
// finance-worksheet.tsx) — cuma buat pecah tampilan "Total Fee" vs "Incentive
// Ontime" di Ringkasan, BUKAN sumber kebenaran duit (itu tetap `fee`, yang
// sudah dikomit ke attendance_logs).
export type AttDetail = {
  date: string;
  clockIn: string | null;
  clockOut: string | null;
  dur: number | null;
  late: boolean;
  absent: boolean;
  fee: number;
  pitstop: string | null;
  clientId: string | null;
  shiftLabel: string | null;
  base: number;
  overtime: number;
  incentiveAmt: number;
};

export type RiderRow = {
  detailId: string;
  rider_id: string;
  name: string;
  employeeId: string;
  clientName: string;
  orderCount: number;
  feeRider: number;
  activeDates: number;
  ded: Record<string, number>;
  incentive: number; // payroll_details.incentive — insentif manual di luar skema (lihat IncentiveEditor)
  total: number;
  remarks: string;
  deliv: DelivDetail[];
  att: AttDetail[];
};

export const rp = (n: number) => "Rp" + Math.round(n).toLocaleString("id-ID");
export const otpLabel = (a: AttDetail) => (a.absent ? "ABSEN" : a.late ? "LATE" : "ONTIME");
export const durLabel = (m: number | null) =>
  m == null ? "—" : `${Math.floor(m / 60)}j ${m % 60}m`;
const durHMS = (m: number | null) => {
  if (m == null) return "—";
  const h = Math.floor(m / 60),
    mm = m % 60;
  return `${h}:${String(mm).padStart(2, "0")}:00`;
};
const idDateLabel = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  return isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("id-ID", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      });
};

// Run yang murni attendance (semua rider tanpa data kiriman sama sekali) —
// pakai layout Detail/Ringkasan yang beda dari run delivery/hybrid.
export const isAttendanceOnlyRun = (rows: RiderRow[]) =>
  rows.length > 0 && rows.every((r) => r.deliv.length === 0) && rows.some((r) => r.att.length > 0);

// 1 rider bisa punya baris di lebih dari 1 pitstop dalam periode yang sama
// — Ringkasan cuma bisa 1 baris per rider (insentif manual & potongan
// tersimpan 1 angka per rider per run, gak per-pitstop), jadi dipilih
// pitstop yang paling sering muncul buat rider itu.
// ponytail: kalau ke depan butuh split per-pitstop beneran, insentif &
// potongan perlu direstrukturisasi jadi per-pitstop dulu, bukan cuma di sini.
function majorityPitstop(att: AttDetail[]): string {
  const counts = new Map<string, number>();
  for (const a of att) {
    const k = a.pitstop ?? "";
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let best = "",
    bestN = -1;
  for (const [k, n] of counts)
    if (n > bestN) {
      best = k;
      bestN = n;
    }
  return best;
}

export function attendanceDetailRows(rows: RiderRow[]): Cell[][] {
  const header: Cell[] = [
    "Pitstop Name",
    "Kode Mitra",
    "Name",
    "Date",
    "Clock-in",
    "Clock-out",
    "Shift",
    "OTP",
    "Work Duration",
    "Calculation Fee",
  ];
  const out: Cell[][] = [header];
  for (const r of rows) {
    for (const a of r.att) {
      out.push([
        a.pitstop ?? "",
        r.employeeId,
        r.name,
        idDateLabel(a.date),
        a.clockIn ?? "",
        a.clockOut ?? "",
        a.shiftLabel ?? "",
        otpLabel(a),
        durHMS(a.dur),
        Math.round(a.base + a.overtime),
      ]);
    }
  }
  return out;
}

export function attendanceSummaryRows(
  rows: RiderRow[],
  run?: { client_id?: string | null; period_start: string; period_end: string },
): Cell[][] {
  const clientLabel = (run?.client_id && rows[0]?.clientName) || "SEMUA CLIENT";
  const title: Cell[][] = [
    [`FEE RIDER ${clientLabel.toUpperCase()}`],
    [`${idDateLabel(run?.period_start ?? "")} - ${idDateLabel(run?.period_end ?? "")}`],
    [],
  ];
  const header: Cell[] = [
    "Pitstop Name",
    "Name",
    "Kode Mitra",
    "LATE",
    "ONTIME",
    "Shift Count",
    "Total Fee",
    "Incentive Ontime",
    "Add Incentive",
    "Bpjs JKK",
    "Deduction",
    "Final Fee",
    "Remark",
  ];

  let gLate = 0,
    gOntime = 0,
    gShift = 0,
    gTotalFee = 0,
    gIncOntime = 0,
    gAddInc = 0,
    gBpjs = 0,
    gDed = 0,
    gFinal = 0;
  const body: Cell[][] = [];
  for (const r of rows) {
    if (r.att.length === 0) continue;
    const shiftCount = r.att.filter((a) => !a.absent).length;
    const late = r.att.filter((a) => a.late && !a.absent).length;
    const ontime = r.att.filter((a) => !a.late && !a.absent).length;
    const totalFee = Math.round(r.att.reduce((s, a) => s + a.base + a.overtime, 0));
    const incOntime = Math.round(r.att.reduce((s, a) => s + a.incentiveAmt, 0));
    const addInc = Math.round(r.incentive);
    const bpjs = Math.round(
      Object.entries(r.ded)
        .filter(([ty]) => /bpjs/i.test(ty))
        .reduce((s, [, v]) => s + v, 0),
    );
    const ded = Math.round(
      Object.entries(r.ded)
        .filter(([ty]) => !/bpjs/i.test(ty))
        .reduce((s, [, v]) => s + v, 0),
    );
    const final = totalFee + incOntime + addInc - bpjs - ded;
    body.push([
      majorityPitstop(r.att),
      r.name,
      r.employeeId,
      late,
      ontime,
      shiftCount,
      totalFee,
      incOntime,
      addInc,
      bpjs || "",
      ded || "",
      final,
      r.remarks,
    ]);
    gLate += late;
    gOntime += ontime;
    gShift += shiftCount;
    gTotalFee += totalFee;
    gIncOntime += incOntime;
    gAddInc += addInc;
    gBpjs += bpjs;
    gDed += ded;
    gFinal += final;
  }
  const grand: Cell[] = [
    "GRAND TOTAL",
    "",
    "",
    gLate,
    gOntime,
    gShift,
    gTotalFee,
    gIncOntime,
    gAddInc,
    gBpjs,
    gDed,
    gFinal,
    "",
  ];
  return [...title, header, ...body, grand];
}
