// Alokasi kasbon ke penerima pihak ke-3 (kasbon_recipients) — direplikasi
// dari alokasi prioritas yang sama persis dengan publish() di
// admin.payroll.tsx (ADM > BPJS > RUSAK > KASBON > SEWA > KUOTA, dari
// gross_earning), TANPA nulis apa-apa ke DB. Dipakai di 2 tempat yang butuh
// angka identik: Bulk Payment (fetchKasbonRecipientRows) dan Finance
// Worksheet (baris "penerima kasbon") — satu sumber logic, jangan diduplikat.
import { DEDUCTION_PRIORITY } from "./payroll-generate";

export interface KasbonDeductionRow {
  detail_id: string;
  amount: number;
  kasbon_recipient_id: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deduction_types?: { code?: string | null } | null;
  kasbon_recipients?: {
    name?: string | null;
    bank_name?: string | null;
    account_number?: string | null;
    account_holder?: string | null;
    no_transfer_needed?: boolean | null;
  } | null;
}

export interface KasbonAllocation {
  recipientId: string;
  recipientName: string;
  bankName: string | null;
  accountNumber: string | null;
  noTransferNeeded: boolean;
  amount: number; // digabung kalau >1 rider di run yang sama motong ke penerima yang sama
  riderNames: string[];
}

export function allocateKasbonByRecipient(
  grossByDetail: Map<string, number>,
  deductionRows: KasbonDeductionRow[],
  riderNameByDetail: Map<string, string>,
): KasbonAllocation[] {
  const byDetail = new Map<string, KasbonDeductionRow[]>();
  for (const d of deductionRows) {
    const arr = byDetail.get(d.detail_id) ?? [];
    arr.push(d);
    byDetail.set(d.detail_id, arr);
  }

  const byRecipient = new Map<string, KasbonAllocation>();
  for (const [detailId, rows] of byDetail) {
    let remaining = grossByDetail.get(detailId) ?? 0;
    const sorted = [...rows].sort(
      (a, b) => (DEDUCTION_PRIORITY[a.deduction_types?.code ?? ""] ?? 99) - (DEDUCTION_PRIORITY[b.deduction_types?.code ?? ""] ?? 99),
    );
    for (const row of sorted) {
      const amount = Number(row.amount) || 0;
      const paid = Math.max(0, Math.min(remaining, amount));
      remaining -= paid;
      if (!row.kasbon_recipient_id || paid <= 0) continue;
      const rec = row.kasbon_recipients;
      const entry = byRecipient.get(row.kasbon_recipient_id) ?? {
        recipientId: row.kasbon_recipient_id,
        recipientName: rec?.account_holder || rec?.name || "",
        bankName: rec?.bank_name ?? null,
        accountNumber: rec?.account_number ?? null,
        noTransferNeeded: !!rec?.no_transfer_needed,
        amount: 0,
        riderNames: [] as string[],
      };
      entry.amount += paid;
      const riderName = riderNameByDetail.get(detailId);
      if (riderName && !entry.riderNames.includes(riderName)) entry.riderNames.push(riderName);
      byRecipient.set(row.kasbon_recipient_id, entry);
    }
  }
  return [...byRecipient.values()];
}
