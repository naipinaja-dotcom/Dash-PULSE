// Atom & helper generik dipakai bareng oleh delivery-fields.tsx,
// attendance-fields.tsx, interactive-calc.tsx, dan shell (pricing-form.tsx).
// Dipecah dari pricing-form.tsx biar reusable antar sub-form.
import type { StepTier } from "@/lib/pricing-types";
import { formatRupiah, parseRupiah } from "@/lib/format";
import { Plus, Trash2 } from "lucide-react";

// Kolom yang BENERAN dipahami resolveField() di pricing-calc.ts (dipakai buat
// match_column/group_by di mana pun) — ketik bebas selain 3 ini (mis. contoh
// placeholder lama "sender_name") diam-diam fallback ke Area/district tanpa
// warning apa pun. Dropdown, bukan text bebas, biar gak ke-ulang lagi.
export const RESOLVABLE_COLUMN_OPTIONS = ["Area", "Service Type", "Delivery Type"] as const;
export function resolvableColumnLabel(opt: string): string {
  if (opt === "Service Type") return "Tipe Layanan (Service Type)";
  if (opt === "Delivery Type") return "Tipe Antar/Kembali (Delivery Type)";
  return "Area / Kota (District)";
}

// -------------------- StepTier: state form <-> envelope --------------------
export interface StepTierState {
  base_fee: string;
  base_until: string;
  tiers: { from: string; to: string; step: string; add_per_step: string }[];
}

export const emptyStepTier = (): StepTierState => ({ base_fee: "", base_until: "", tiers: [] });

export function buildStepTier(s: StepTierState): StepTier {
  return {
    base_fee: parseRupiah(s.base_fee),
    base_until: Number(s.base_until) || 0,
    tiers: s.tiers.map((t) => ({
      from: Number(t.from) || 0,
      to: t.to.trim() === "" ? null : Number(t.to),
      step: Number(t.step) || 1,
      add_per_step: parseRupiah(t.add_per_step),
    })),
  };
}

export function stepTierToState(t: StepTier | null | undefined): StepTierState {
  if (!t) return emptyStepTier();
  return {
    base_fee: String(t.base_fee ?? ""),
    base_until: String(t.base_until ?? ""),
    tiers: (t.tiers ?? []).map((x) => ({
      from: String(x.from ?? ""),
      to: x.to === null || x.to === undefined ? "" : String(x.to),
      step: String(x.step || 1), // skema lama disimpen tanpa step -> default 1, biar keliatan (bukan placeholder abu-abu)
      add_per_step: String(x.add_per_step ?? ""),
    })),
  };
}

// Dipakai kalkulator interaktif — hitung breakdown step-tier utk 1 nilai (km/kg).
export interface ExStep {
  text: string;
  amount?: number;
}


// -------------------- Shared inputs --------------------
export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={
        "w-full text-sm rounded-md border border-border bg-card px-2.5 py-1.5 outline-none focus:ring-2 focus:ring-ring focus:border-primary-border " +
        (props.className ?? "")
      }
    />
  );
}

export function RupiahInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const display = value ? Number(parseRupiah(value)).toLocaleString("id-ID") : "";
  return (
    <TextInput
      value={display}
      placeholder={placeholder ?? "0"}
      onChange={(e) => onChange(String(parseRupiah(e.target.value)))}
      inputMode="numeric"
    />
  );
}

export function AddRowBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full mt-2 text-xs text-primary border border-dashed border-primary-border rounded-md px-3 py-1.5 hover:bg-primary-soft/50 inline-flex items-center justify-center gap-1.5"
    >
      <Plus className="w-3.5 h-3.5" />
      {children}
    </button>
  );
}

export function TableShell({ head, children }: { head: React.ReactNode; children: React.ReactNode }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">{head}</tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}
export function Th({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <th className={"font-medium pb-2 pr-2 " + className}>{children}</th>;
}
export function Td({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <td className={"py-1 pr-2 align-middle " + className}>{children}</td>;
}
export function RowDeleteBtn({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-muted">
      <Trash2 className="w-3.5 h-3.5" />
    </button>
  );
}

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="text-xs text-muted-foreground">{children}</label>;
}

// StepTier editor — mirrors mockup's Tier Configuration table:
// MIN | MAX | BASE FEE | PER KM, with row 0 being the base_fee/base_until pair.
export function StepTierEditor({ value, onChange, unit }: { value: StepTierState; onChange: (v: StepTierState) => void; unit: "km" | "kg" }) {
  const setTier = (i: number, patch: Partial<StepTierState["tiers"][number]>) =>
    onChange({ ...value, tiers: value.tiers.map((t, idx) => (idx === i ? { ...t, ...patch } : t)) });
  const addTier = () => onChange({ ...value, tiers: [...value.tiers, { from: value.base_until || "0", to: "", step: "1", add_per_step: "0" }] });
  const delTier = (i: number) => onChange({ ...value, tiers: value.tiers.filter((_, idx) => idx !== i) });

  const inputCls = "w-full text-sm rounded border border-border/80 bg-background px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-primary/50 tabular-nums";

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
        <span className="text-sm font-semibold">Tier Configuration</span>
        <button type="button" onClick={addTier}
          className="inline-flex items-center gap-1.5 text-xs font-medium border border-border rounded-md px-2.5 py-1.5 hover:bg-muted transition-colors">
          <Plus className="w-3.5 h-3.5" /> Add Tier
        </button>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
            <th className="px-3 py-2 text-left">Min ({unit})</th>
            <th className="px-3 py-2 text-left">Max ({unit})</th>
            <th className="px-3 py-2 text-left">Base Fee (Rp)</th>
            <th className="px-3 py-2 text-left">Step ({unit})</th>
            <th className="px-3 py-2 text-left">Per Step (Rp)</th>
            <th className="px-3 py-2 w-10" />
          </tr>
        </thead>
        <tbody>
          {/* Row 0 — base fee entry (min fixed at 0) */}
          <tr className="border-t border-border/60">
            <td className="px-3 py-1.5 text-muted-foreground tabular-nums">0</td>
            <td className="px-3 py-1.5">
              <input className={inputCls} value={value.base_until} inputMode="decimal"
                onChange={(e) => onChange({ ...value, base_until: e.target.value })} placeholder="0" />
            </td>
            <td className="px-3 py-1.5">
              <input className={inputCls} value={value.base_fee ? Number(formatRupiah(value.base_fee).replace(/\D/g, "")).toLocaleString("id-ID") : ""}
                inputMode="numeric" placeholder="0"
                onChange={(e) => onChange({ ...value, base_fee: String(parseRupiah(e.target.value)) })} />
            </td>
            <td className="px-3 py-1.5 text-muted-foreground text-center">—</td>
            <td className="px-3 py-1.5 text-muted-foreground text-center">—</td>
            <td />
          </tr>
          {/* Tier rows */}
          {value.tiers.map((t, i) => (
            <tr key={i} className="border-t border-border/60 hover:bg-muted/30 transition-colors">
              <td className="px-3 py-1.5"><input className={inputCls} value={t.from} inputMode="decimal" onChange={(e) => setTier(i, { from: e.target.value })} /></td>
              <td className="px-3 py-1.5"><input className={inputCls} value={t.to} placeholder="∞" inputMode="decimal" onChange={(e) => setTier(i, { to: e.target.value })} /></td>
              <td className="px-3 py-1.5 text-muted-foreground text-center">—</td>
              <td className="px-3 py-1.5">
                <input className={inputCls} value={t.step} inputMode="decimal" placeholder="1"
                  onChange={(e) => setTier(i, { step: e.target.value })} />
              </td>
              <td className="px-3 py-1.5">
                <input className={inputCls} value={t.add_per_step ? Number(t.add_per_step).toLocaleString("id-ID") : ""}
                  inputMode="numeric" placeholder="0"
                  onChange={(e) => setTier(i, { add_per_step: String(parseRupiah(e.target.value)) })} />
              </td>
              <td className="px-2 text-center">
                <button type="button" onClick={() => delTier(i)} className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-muted transition-colors">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ToggleBlock({ label, hint, on, onToggle, children }: { label: string; hint?: string; on: boolean; onToggle: (on: boolean) => void; children?: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-card p-3.5">
      <label className="flex items-start gap-2.5 cursor-pointer">
        <input type="checkbox" checked={on} onChange={(e) => onToggle(e.target.checked)} className="mt-0.5" />
        <span>
          <span className="text-sm font-medium">{label}</span>
          {hint && <span className="block text-[11px] text-muted-foreground leading-snug">{hint}</span>}
        </span>
      </label>
      {on && <div className="mt-3">{children}</div>}
    </div>
  );
}
