import { parseRupiah } from "@/lib/format";

export interface EwaRiderRef {
  id: string;
  employee_id: string;
  full_name: string;
}

export interface EwaRow {
  line: number;
  riderId: string;
  employeeId: string;
  name: string;
  amount: number;
}

export interface EwaLineError {
  line: number;
  raw: string;
  reason: string;
}

// Daftar EWA hasil paste dari spreadsheet: 1 rider per baris, "kode_mitra<pemisah>nominal".
// Pemisah bisa tab (paste Sheets), koma, titik-koma, atau spasi. Kode mitra = token pertama
// (employee_id gak pernah mengandung spasi); sisanya dibaca sebagai nominal Rupiah, jadi
// "257.100" dan "Rp 257.100" sama-sama valid.
export function parseEwaLines(
  text: string,
  riders: EwaRiderRef[],
): { rows: EwaRow[]; errors: EwaLineError[] } {
  const byCode = new Map(riders.map((r) => [r.employee_id.trim().toLowerCase(), r]));
  const rows: EwaRow[] = [];
  const errors: EwaLineError[] = [];
  const seen = new Set<string>();

  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    if (!raw.trim()) return;
    const m = raw.match(/^\s*([^\s,;]+)[\s,;]+(.+?)\s*$/);
    if (!m) {
      errors.push({ line, raw, reason: "Format harus: kode mitra lalu nominal" });
      return;
    }
    const code = m[1].toLowerCase();
    const amount = parseRupiah(m[2]);
    const rider = byCode.get(code);
    if (!rider) {
      errors.push({ line, raw, reason: `Kode mitra "${m[1]}" tidak ditemukan` });
      return;
    }
    if (amount <= 0) {
      errors.push({ line, raw, reason: "Nominal harus lebih dari 0" });
      return;
    }
    if (seen.has(rider.id)) {
      errors.push({ line, raw, reason: `Kode mitra "${m[1]}" dobel di daftar` });
      return;
    }
    seen.add(rider.id);
    rows.push({
      line,
      riderId: rider.id,
      employeeId: rider.employee_id,
      name: rider.full_name,
      amount,
    });
  });

  return { rows, errors };
}
