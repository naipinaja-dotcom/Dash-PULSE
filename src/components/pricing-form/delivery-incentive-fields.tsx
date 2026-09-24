// Insentif Pengiriman — insentif tambahan per rider PER HARI KERJA (uang
// bensin, uang makan, dsb). BEDA dari IncentiveEditor (components/
// incentive-editor.tsx), yang manual diketik admin per rider per payroll run
// sekali jalan — ini nempel ke SKEMA, otomatis kehitung ulang tiap run tanpa
// admin input ulang. Cair sekali per rider per hari (lihat DeliveryIncentive
// di pricing-types.ts & grouping rider+hari di calcScheme, pricing-calc.ts —
// sama pola kayak Multi-drop, bukan per-order). Pola state/build/load/validate
// di file ini niru area-city-fields.tsx (list of rows, semua string, di-parse
// saat build).
import type { DeliveryIncentive } from "@/lib/pricing-types";
import { parseRupiah } from "@/lib/format";
import { Plus, Trash2 } from "lucide-react";
import { useT } from "@/lib/i18n";
import { TextInput, RupiahInput } from "./shared";

export interface DeliveryIncentiveRowState {
  id: string;
  label: string;
  amount: string; // di-parse (parseRupiah) saat build
  period: "daily" | "weekly" | "monthly";
}

export function emptyDeliveryIncentiveState(): DeliveryIncentiveRowState[] {
  return [];
}

function newRowId(): string {
  return `dinc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function loadDeliveryIncentiveState(
  incentives: DeliveryIncentive[] | null | undefined,
): DeliveryIncentiveRowState[] {
  if (!incentives?.length) return [];
  return incentives.map((inc) => ({
    id: newRowId(),
    label: inc.label,
    amount: String(inc.amount ?? ""),
    period: inc.period ?? "daily",
  }));
}

// Dipanggil dari buildEnvelope (pricing-form.tsx) — baris kosong (nama/nominal
// belum keisi) di-skip diam-diam (sama pola buildAreaCityConfig), `enabled`
// dari toggle ToggleBlock. null kalau toggle mati ATAU semua baris kosong —
// biar calcScheme fallback ke "gak ada insentif" (perilaku identik sebelum
// fitur ini), bukan nyimpen array isinya cuma baris kosong.
export function buildDeliveryIncentives(
  rows: DeliveryIncentiveRowState[],
  enabled: boolean,
): DeliveryIncentive[] | null {
  if (!enabled) return null;
  const built: DeliveryIncentive[] = rows
    .filter((r) => r.label.trim() && parseRupiah(r.amount) > 0)
    .map((r) => ({
      label: r.label.trim(),
      amount: parseRupiah(r.amount),
      condition: "always",
      period: r.period,
    }));
  return built.length > 0 ? built : null;
}

// Validasi sebelum save — pola sama kayak validateAreaCityState. Return pesan
// error pertama yang ketemu, atau null kalau valid.
export function validateDeliveryIncentiveState(rows: DeliveryIncentiveRowState[]): string | null {
  if (rows.length === 0)
    return "Insentif Pengiriman aktif tapi belum ada item — tambah minimal 1 insentif atau matikan toggle-nya.";
  for (const r of rows) {
    if (!r.label.trim()) return "Setiap insentif butuh nama (mis. Uang Bensin).";
    if (!(parseRupiah(r.amount) > 0))
      return `Insentif "${r.label.trim() || "(tanpa nama)"}" belum punya nominal.`;
  }
  return null;
}

export function DeliveryIncentiveFields({
  value,
  onChange,
}: {
  value: DeliveryIncentiveRowState[];
  onChange: (v: DeliveryIncentiveRowState[]) => void;
}) {
  const { t } = useT();
  const setRow = (i: number, patch: Partial<DeliveryIncentiveRowState>) =>
    onChange(value.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRow = () =>
    onChange([...value, { id: newRowId(), label: "", amount: "", period: "daily" }]);
  const delRow = (i: number) => onChange(value.filter((_, idx) => idx !== i));

  return (
    <div className="flex flex-col gap-2">
      {value.length === 0 && (
        <p className="text-xs text-muted-foreground">{t("pfIncentive.empty")}</p>
      )}
      {value.map((r, i) => (
        <div key={r.id} className="flex items-center gap-1.5">
          <div className="flex-1">
            <TextInput
              value={r.label}
              placeholder={t("pfIncentive.labelPlaceholder")}
              onChange={(e) => setRow(i, { label: e.target.value })}
            />
          </div>
          <div className="w-32 flex-shrink-0">
            <RupiahInput value={r.amount} onChange={(v) => setRow(i, { amount: v })} />
          </div>
          <div className="w-32 flex-shrink-0">
            <select
              value={r.period}
              onChange={(e) =>
                setRow(i, { period: e.target.value as "daily" | "weekly" | "monthly" })
              }
              className="w-full text-sm rounded-md border border-border bg-card px-2.5 py-1.5"
            >
              <option value="daily">{t("pfIncentive.periodDaily")}</option>
              <option value="weekly">{t("pfIncentive.periodWeekly")}</option>
              <option value="monthly">{t("pfIncentive.periodMonthly")}</option>
            </select>
          </div>
          <button
            type="button"
            onClick={() => delRow(i)}
            className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-muted flex-shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addRow}
        className="w-full text-xs text-primary border border-dashed border-primary-border rounded-md px-3 py-1.5 hover:bg-primary-soft/50 inline-flex items-center justify-center gap-1.5"
      >
        <Plus className="w-3.5 h-3.5" /> {t("pfIncentive.addItem")}
      </button>
    </div>
  );
}
