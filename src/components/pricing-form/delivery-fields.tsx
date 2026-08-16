// Kategori 1 — Per Pengiriman (Distance / Weight). Redesign v2: bukan lagi
// 4 modul checkbox terpisah (flat/tierDistance/tierWeight/threshold), tapi 2
// dimensi (Distance, Weight) yang masing-masing punya 1 TABEL RANGE — tiap
// baris bisa tipe "Flat" (harga tetap per band) atau "Tier" (base + step per
// band). Band-independent: dicari band mana yang cocok, band lain diabaikan
// (bukan akumulasi cumulative kayak StepTier lama). Weight punya mode
// tambahan "Kelipatan per Store" (pengganti Threshold Kelipatan lama).
//
// Backward-compat: skema lama (flat_unit/tier/tier_daily/threshold_multiple)
// tetap DIHITUNG dengan logic lama (pricing-calc.ts tidak menyentuh fungsi
// lama). Begitu admin BUKA skema lama ini di form & save ulang, otomatis
// ke-upgrade ke format modular_v2 (lihat `loadModularDeliveryState` di bawah
// buat konversi baca, `buildModularDeliveryConfig` buat konversi tulis).
import { useState } from "react";
import type {
  DeliveryDimensions,
  PricingCalcType,
  RangeRow,
  RangeDimensionConfig,
  ModularDeliveryConfig,
  StepTier,
} from "@/lib/pricing-types";
import { parseRupiah } from "@/lib/format";
import { bandFeeAt } from "@/lib/pricing-calc";
import { AddRowBtn, FieldLabel, RupiahInput, Td, TableShell, TextInput, Th, RowDeleteBtn, ToggleBlock, RESOLVABLE_COLUMN_OPTIONS, resolvableColumnLabel, sanitizeDecimalInput } from "./shared";
import { Plus, Ruler, Package } from "lucide-react";

// -------------------- State shapes (semua string, di-parse saat simpan) --------------------
export interface RangeRowState {
  type: "flat" | "tier";
  from: string;
  to: string; // "" = tak terbatas (band terakhir)
  base_fee: string;
  step: string; // dipakai kalau type=tier
  add_per_step: string; // dipakai kalau type=tier
}

export interface RangeDimensionState {
  enabled: boolean;
  accumulate: "per_order" | "daily";
  rows: RangeRowState[];
}

export interface ThresholdGroupState {
  group_by: string;
  default_threshold: string;
  default_rate: string;
  rules: { key: string; threshold: string; rate: string }[];
}

export interface WeightRangeState extends RangeDimensionState {
  mode: "range" | "threshold_group";
  threshold: ThresholdGroupState;
}

export interface WeightSurchargeState {
  enabled: boolean;
  threshold_kg: string;
  multiplier: string;
}

export interface ModularDeliveryState {
  distance: RangeDimensionState;
  weight: WeightRangeState;
  rate_by: "flat" | "column" | "delivery_type";
  match_column: string;
  rates: { key: string; rate: string }[];
  default_rate: string;
  unit_basis: "awb" | "unique_address";
  weight_surcharge: WeightSurchargeState;
}

// Alias dipakai pricing-form.tsx (bentuk state delivery keseluruhan)
export type DeliveryState = ModularDeliveryState;

// Cuma 2 kolom yang beneran dikenali mesin hitung (lihat resolveField() di
// pricing-calc.ts) — mode "column" gak butuh delivery_type karena itu udah
// jadi rate_by pilihan sendiri. Dropdown, bukan free-text, biar gak ada admin
// ngetik nama kolom yang salah lalu diam-diam dianggap "Area".
const MATCH_COLUMN_OPTIONS = ["Area", "Service Type"] as const;
function canonicalMatchColumn(raw: string): string {
  const c = String(raw ?? "").trim().toLowerCase();
  return c.includes("service") || c.includes("layanan") ? "Service Type" : "Area";
}

function emptyRangeRow(type: "flat" | "tier", from = "0"): RangeRowState {
  return { type, from, to: "", base_fee: "", step: type === "tier" ? "1" : "0", add_per_step: "0" };
}

export function emptyDeliveryState(): ModularDeliveryState {
  return {
    distance: { enabled: false, accumulate: "per_order", rows: [] },
    weight: {
      enabled: false,
      accumulate: "per_order",
      mode: "range",
      rows: [],
      threshold: { group_by: "Area", default_threshold: "10", default_rate: "40000", rules: [] },
    },
    rate_by: "flat",
    match_column: "Area",
    rates: [],
    default_rate: "0",
    unit_basis: "awb",
    weight_surcharge: { enabled: false, threshold_kg: "20", multiplier: "2" },
  };
}

// -------------------- Build (state -> envelope config) --------------------
function buildRangeRow(r: RangeRowState): RangeRow {
  return {
    type: r.type,
    from: Number(r.from) || 0,
    to: r.to.trim() === "" ? null : Number(r.to),
    base_fee: parseRupiah(r.base_fee),
    step: r.type === "tier" ? Number(r.step) || 1 : 0,
    add_per_step: r.type === "tier" ? parseRupiah(r.add_per_step) : 0,
  };
}

// `enabled` diterima sebagai parameter (dari checkbox/subtype), BUKAN dibaca
// dari d.enabled — field itu cuma keikut loadDeliveryState() pas buka skema
// lama, gak pernah di-toggle checkbox (sama persis bug yang kejadian di
// buildDeliveryConfig, cuma nempel satu langkah lebih dalam).
function buildRangeDimension(enabled: boolean, d: RangeDimensionState): RangeDimensionConfig {
  return { enabled, accumulate: d.accumulate, rows: d.rows.map(buildRangeRow) };
}

export function deliveryEnvelopeType(_subtype: unknown, _d: DeliveryState): PricingCalcType {
  return "modular_v2";
}

export function buildDeliveryConfig(subtype: unknown, d: ModularDeliveryState): ModularDeliveryConfig {
  // Sumber kebenaran "dimensi mana yang aktif" adalah checkbox Distance/Weight
  // (subtype) di pricing-form.tsx, BUKAN d.distance.enabled/d.weight.enabled —
  // dua field itu cuma keikut dari loadDeliveryState() pas buka skema lama,
  // gak pernah di-toggle checkbox-nya, jadi kalau dipakai balik di sini
  // hasilnya selalu null/default meski tabelnya udah diisi di layar.
  const dims = (subtype as { distance?: boolean; weight?: boolean } | null) || { distance: false, weight: false };
  const weightDim = buildRangeDimension(!!dims.weight, d.weight);
  return {
    distance: dims.distance ? buildRangeDimension(true, d.distance) : null,
    weight: dims.weight
      ? {
          ...weightDim,
          mode: d.weight.mode,
          threshold:
            d.weight.mode === "threshold_group"
              ? {
                  group_by: d.weight.threshold.group_by,
                  default_threshold: Number(d.weight.threshold.default_threshold) || 0,
                  default_rate: parseRupiah(d.weight.threshold.default_rate),
                  rules: d.weight.threshold.rules.map((r) => ({
                    key: r.key,
                    threshold: Number(r.threshold) || 0,
                    rate: parseRupiah(r.rate),
                  })),
                }
              : undefined,
        }
      : null,
    rate_by: d.rate_by,
    match_column: d.match_column,
    rates: d.rates.map((r) => ({ key: r.key, rate: parseRupiah(r.rate) })),
    default_rate: parseRupiah(d.default_rate),
    unit_basis: d.unit_basis,
    _dims: { distance: !!dims.distance, weight: !!dims.weight },
    // Cuma masuk akal kalau Distance aktif (dia yang kena kali) — checkbox-nya
    // juga disembunyiin di UI kalau Distance mati (lihat DeliveryFields).
    weight_surcharge:
      dims.distance && d.weight_surcharge.enabled
        ? {
            enabled: true,
            threshold_kg: Number(d.weight_surcharge.threshold_kg) || 0,
            multiplier: Number(d.weight_surcharge.multiplier) || 1,
          }
        : null,
  };
}

// -------------------- Load (envelope config -> state), termasuk konversi legacy --------------------
function rangeRowToState(row: RangeRow): RangeRowState {
  return {
    type: row.type,
    from: String(row.from ?? 0),
    to: row.to === null || row.to === undefined ? "" : String(row.to),
    base_fee: String(row.base_fee ?? 0),
    step: String(row.step ?? (row.type === "tier" ? 1 : 0)),
    add_per_step: String(row.add_per_step ?? 0),
  };
}

// Best-effort konversi StepTier lama (cumulative) -> RangeRow[] (band-independent).
// BUKAN migrasi matematis sempurna — base_fee tier lanjutan dipertahankan sama
// dengan base_fee awal (karena makna "base" beda antara 2 model), tujuannya
// cuma biar data lama kebuka & bisa diedit ulang di editor baru, bukan
// menjamin hasil hitung identik. Admin disarankan cek ulang angkanya.
function stepTierToRangeRows(t: StepTier): RangeRowState[] {
  const rows: RangeRowState[] = [
    {
      type: "flat",
      from: "0",
      to: String(t.base_until ?? 0),
      base_fee: String(t.base_fee ?? 0),
      step: "0",
      add_per_step: "0",
    },
  ];
  for (const tier of t.tiers ?? []) {
    rows.push({
      type: "tier",
      from: String(tier.from ?? 0),
      to: tier.to === null || tier.to === undefined ? "" : String(tier.to),
      base_fee: String(t.base_fee ?? 0),
      step: String(tier.step || 1),
      add_per_step: String(tier.add_per_step ?? 0),
    });
  }
  return rows;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function loadDeliveryState(_subtype: unknown, legacyType: PricingCalcType, c: any): ModularDeliveryState {
  const state = emptyDeliveryState();

  if (legacyType === "modular_v2") {
    if (c.distance) {
      state.distance = {
        enabled: true,
        accumulate: c.distance.accumulate ?? "per_order",
        rows: (c.distance.rows ?? []).map(rangeRowToState),
      };
    }
    if (c.weight) {
      state.weight = {
        enabled: true,
        accumulate: c.weight.accumulate ?? "per_order",
        mode: c.weight.mode ?? "range",
        rows: (c.weight.rows ?? []).map(rangeRowToState),
        threshold: c.weight.threshold
          ? {
              group_by: c.weight.threshold.group_by ?? "Area",
              default_threshold: String(c.weight.threshold.default_threshold ?? "10"),
              default_rate: String(c.weight.threshold.default_rate ?? "40000"),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              rules: (c.weight.threshold.rules ?? []).map((r: any) => ({
                key: r.key,
                threshold: String(r.threshold),
                rate: String(r.rate),
              })),
            }
          : state.weight.threshold,
      };
    }
    state.rate_by = c.rate_by ?? "flat";
    state.match_column = canonicalMatchColumn(c.match_column ?? "Area");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    state.rates = (c.rates ?? []).map((r: any) => ({ key: r.key, rate: String(r.rate) }));
    state.default_rate = String(c.default_rate ?? "0");
    state.unit_basis = c.unit_basis ?? "awb";
    if (c.weight_surcharge) {
      state.weight_surcharge = {
        enabled: !!c.weight_surcharge.enabled,
        threshold_kg: String(c.weight_surcharge.threshold_kg ?? "20"),
        multiplier: String(c.weight_surcharge.multiplier ?? "2"),
      };
    }
    return state;
  }

  // ---- Legacy: flat_unit ----
  if (legacyType === "flat_unit") {
    state.distance = {
      enabled: true,
      accumulate: "per_order",
      rows: [
        {
          type: "flat",
          from: "0",
          to: "",
          base_fee: String(c.flat_rate ?? c.default_rate ?? "0"),
          step: "0",
          add_per_step: "0",
        },
      ],
    };
    state.rate_by = c.rate_by ?? "flat";
    state.match_column = canonicalMatchColumn(c.match_column ?? "Area");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    state.rates = (c.rates ?? []).map((r: any) => ({ key: r.key, rate: String(r.rate) }));
    state.unit_basis = c.unit === "unique_address" ? "unique_address" : "awb";
    return state;
  }

  // ---- Legacy: tier / tier_daily ----
  if (legacyType === "tier" || legacyType === "tier_daily") {
    const accumulate = legacyType === "tier_daily" ? "daily" : "per_order";
    if (c.distance) {
      state.distance = { enabled: true, accumulate, rows: stepTierToRangeRows(c.distance) };
    }
    if (c.weight) {
      state.weight = { ...state.weight, enabled: true, accumulate, mode: "range", rows: stepTierToRangeRows(c.weight) };
    }
    return state;
  }

  // ---- Legacy: threshold_multiple ----
  if (legacyType === "threshold_multiple") {
    state.weight = {
      enabled: true,
      accumulate: "per_order",
      mode: "threshold_group",
      rows: [],
      threshold: {
        group_by: c.group_by ?? "Area",
        default_threshold: String(c.default?.threshold ?? "10"),
        default_rate: String(c.default?.rate ?? "40000"),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        rules: (c.rules ?? []).map((r: any) => ({ key: r.key, threshold: String(r.threshold), rate: String(r.rate) })),
      },
    };
    return state;
  }

  return state;
}

// -------------------- UI: tabel range (Flat/Tier campur), band-independent --------------------
function RangeTableEditor({
  rows,
  onChange,
  unit,
}: {
  rows: RangeRowState[];
  onChange: (rows: RangeRowState[]) => void;
  unit: "km" | "kg";
}) {
  const patchRow = (i: number, p: Partial<RangeRowState>) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...p } : r)));
  const delRow = (i: number) => onChange(rows.filter((_, idx) => idx !== i));
  const addRow = (type: "flat" | "tier") => {
    const last = rows[rows.length - 1];
    const from = last && last.to.trim() !== "" ? last.to : last ? "" : "0";
    const row = emptyRangeRow(type, from || "0");
    // Base fee nerusin dari baris sebelumnya — bukan nyalin mentah base_fee
    // baris lama (dulu gitu, hasilnya 0 kalau base_fee baris lama 0 walau
    // step-nya udah numpuk banyak), tapi DIHITUNG dulu fee baris lama itu di
    // titik paling atasnya (`to`), pakai rumus band yang sama kayak mesin
    // hitung (bandFeeAt, pricing-calc.ts) — biar baris baru nyambung mulus,
    // gak ujug-ujug jatuh ke 0. Tetep bisa diubah manual kalau band ini
    // emang mau base yang beda. Cuma kepake kalau `to` baris lama jelas
    // (bukan tak terbatas — gak ada titik buat dihitung kalau ∞).
    if (last && last.to.trim() !== "") {
      row.base_fee = String(
        bandFeeAt(
          {
            type: last.type,
            from: Number(last.from) || 0,
            to: Number(last.to),
            base_fee: parseRupiah(last.base_fee),
            step: last.type === "tier" ? Number(last.step) || 1 : 0,
            add_per_step: last.type === "tier" ? parseRupiah(last.add_per_step) : 0,
          },
          Number(last.to),
        ),
      );
    } else if (last) {
      row.base_fee = last.base_fee;
    }
    onChange([...rows, row]);
  };

  const inputCls =
    "w-full text-sm rounded border border-border/80 bg-background px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-primary/50 tabular-nums";

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide bg-muted">
            <th className="px-3 py-2 text-left">Variant</th>
            <th className="px-3 py-2 text-left">From ({unit})</th>
            <th className="px-3 py-2 text-left">To ({unit})</th>
            <th className="px-3 py-2 text-left">Base (Rp)</th>
            <th className="px-3 py-2 text-left">Step ({unit})</th>
            <th className="px-3 py-2 text-left">+Rp/Step</th>
            <th className="px-3 py-2 w-10" />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-3 py-4 text-center text-xs text-muted-foreground">
                Belum ada baris. Tambah Flat atau Tier di bawah.
              </td>
            </tr>
          ) : (
            rows.map((r, i) => (
              <tr key={i} className="border-t border-border/60 hover:bg-muted/30 transition-colors">
                <td className="px-3 py-1.5">
                  <span
                    className={
                      "inline-block text-[11px] font-medium px-2 py-0.5 rounded " +
                      (r.type === "flat" ? "border-2 border-border-strong bg-primary text-primary-foreground" : "border-2 border-border-strong bg-warning text-warning-foreground")
                    }
                  >
                    {r.type === "flat" ? "Flat" : "Tier"}
                  </span>
                </td>
                <td className="px-3 py-1.5">
                  <input className={inputCls} value={r.from} inputMode="decimal" onChange={(e) => patchRow(i, { from: sanitizeDecimalInput(e.target.value) })} />
                </td>
                <td className="px-3 py-1.5">
                  <input
                    className={inputCls}
                    value={r.to}
                    placeholder="∞"
                    inputMode="decimal"
                    onChange={(e) => patchRow(i, { to: sanitizeDecimalInput(e.target.value) })}
                  />
                </td>
                <td className="px-3 py-1.5">
                  <input
                    className={inputCls}
                    value={r.base_fee ? Number(parseRupiah(r.base_fee)).toLocaleString("id-ID") : ""}
                    inputMode="numeric"
                    placeholder="0"
                    onChange={(e) => patchRow(i, { base_fee: String(parseRupiah(e.target.value)) })}
                  />
                </td>
                <td className="px-3 py-1.5">
                  {r.type === "tier" ? (
                    <input
                      className={inputCls}
                      value={r.step}
                      inputMode="decimal"
                      placeholder="1"
                      onChange={(e) => patchRow(i, { step: sanitizeDecimalInput(e.target.value) })}
                    />
                  ) : (
                    <span className="text-muted-foreground text-center block">—</span>
                  )}
                </td>
                <td className="px-3 py-1.5">
                  {r.type === "tier" ? (
                    <input
                      className={inputCls}
                      value={r.add_per_step ? Number(parseRupiah(r.add_per_step)).toLocaleString("id-ID") : ""}
                      inputMode="numeric"
                      placeholder="0"
                      onChange={(e) => patchRow(i, { add_per_step: String(parseRupiah(e.target.value)) })}
                    />
                  ) : (
                    <span className="text-muted-foreground text-center block">—</span>
                  )}
                </td>
                <td className="px-2 text-center">
                  <RowDeleteBtn onClick={() => delRow(i)} />
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      <div className="flex items-center gap-2 px-3 py-2.5 border-t border-border bg-muted/20">
        <button
          type="button"
          onClick={() => addRow("flat")}
          className="inline-flex items-center gap-1.5 text-xs font-medium border border-border rounded-md px-2.5 py-1.5 hover:bg-muted transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> Add Flat
        </button>
        <span className="text-[11px] text-muted-foreground">OR</span>
        <button
          type="button"
          onClick={() => addRow("tier")}
          className="inline-flex items-center gap-1.5 text-xs font-medium border border-border rounded-md px-2.5 py-1.5 hover:bg-muted transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> Add Tier
        </button>
      </div>
    </div>
  );
}

function AccumulateToggle({ value, onChange }: { value: "per_order" | "daily"; onChange: (v: "per_order" | "daily") => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {([{ k: "per_order", l: "Per Kiriman" }, { k: "daily", l: "Akumulasi Harian" }] as const).map((opt) => (
        <button
          key={opt.k}
          type="button"
          onClick={() => onChange(opt.k)}
          className={
            "text-xs px-3 py-1.5 rounded-md border-2 border-border-strong transition-colors " +
            (value === opt.k
              ? "bg-primary text-primary-foreground shadow-[3px_3px_0_0_var(--color-border-strong)] font-medium"
              : "bg-card text-foreground hover:bg-muted")
          }
        >
          {opt.l}
        </button>
      ))}
    </div>
  );
}

function ThresholdGroupEditor({ value, onChange }: { value: ThresholdGroupState; onChange: (v: ThresholdGroupState) => void }) {
  const patch = (p: Partial<ThresholdGroupState>) => onChange({ ...value, ...p });
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Qty dibaca dari berat aktual (kg), dikelompokkan per store/area. Fee per grup = ceil(total kg / threshold) × rate.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="flex flex-col gap-1.5">
          <FieldLabel>Kolom pengelompokan</FieldLabel>
          <select
            value={value.group_by}
            onChange={(e) => patch({ group_by: e.target.value })}
            className="w-full text-sm rounded-md border border-border bg-card px-2.5 py-1.5"
          >
            {RESOLVABLE_COLUMN_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>{resolvableColumnLabel(opt)}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel>Default Threshold (kg)</FieldLabel>
          <TextInput
            value={value.default_threshold}
            inputMode="decimal"
            onChange={(e) => patch({ default_threshold: sanitizeDecimalInput(e.target.value) })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel>Default Rate (Rp)</FieldLabel>
          <RupiahInput value={value.default_rate} onChange={(v) => patch({ default_rate: v })} />
        </div>
      </div>
      <TableShell head={<>
        <Th>Area / Store</Th>
        <Th className="w-32">Threshold (kg)</Th>
        <Th className="w-44">Rate (Rp)</Th>
        <Th className="w-10" />
      </>}>
        {value.rules.map((r, i) => (
          <tr key={i} className="border-t border-border/60">
            <Td>
              <TextInput
                value={r.key}
                onChange={(e) => patch({ rules: value.rules.map((x, idx) => (idx === i ? { ...x, key: e.target.value } : x)) })}
              />
            </Td>
            <Td>
              <TextInput
                value={r.threshold}
                inputMode="decimal"
                onChange={(e) =>
                  patch({ rules: value.rules.map((x, idx) => (idx === i ? { ...x, threshold: sanitizeDecimalInput(e.target.value) } : x)) })
                }
              />
            </Td>
            <Td>
              <RupiahInput
                value={r.rate}
                onChange={(v) => patch({ rules: value.rules.map((x, idx) => (idx === i ? { ...x, rate: v } : x)) })}
              />
            </Td>
            <Td className="text-center">
              <RowDeleteBtn onClick={() => patch({ rules: value.rules.filter((_, idx) => idx !== i) })} />
            </Td>
          </tr>
        ))}
      </TableShell>
      <AddRowBtn onClick={() => patch({ rules: [...value.rules, { key: "", threshold: "", rate: "" }] })}>
        Tambah Store
      </AddRowBtn>
    </div>
  );
}

// -------------------- Main --------------------
export function DeliveryFields({
  subtype,
  value,
  onChange,
}: {
  subtype: DeliveryDimensions | null;
  value: ModularDeliveryState;
  onChange: (v: ModularDeliveryState) => void;
}) {
  const dims = subtype || { distance: false, weight: false };
  const noDims = !dims.distance && !dims.weight;
  // Kalau Distance/Weight dua-duanya OFF, panel di bawah ("Pengaturan lain")
  // JADI satu-satunya cara nentuin tarif (flat per kiriman, dibedain per
  // kolom/delivery-type) — buka otomatis, bukan disembunyiin kayak sebelumnya
  // (skema kayak gitu dulu jadi kekunci: rates keisi tapi gak pernah kepake).
  const [rateOpen, setRateOpen] = useState(noDims);

  const patchDistance = (p: Partial<RangeDimensionState>) => onChange({ ...value, distance: { ...value.distance, ...p } });
  const patchWeight = (p: Partial<WeightRangeState>) => onChange({ ...value, weight: { ...value.weight, ...p } });
  const patchWeightSurcharge = (p: Partial<WeightSurchargeState>) =>
    onChange({ ...value, weight_surcharge: { ...value.weight_surcharge, ...p } });

  return (
    <div className="space-y-5">
      {noDims && (
        <p className="text-xs text-muted-foreground">
          Distance/Weight gak dipilih — skema ini flat per kiriman, atur tarifnya di "Pengaturan lain" di bawah
          (mis. dibedain per Antar/Kembali atau per Area).
        </p>
      )}
      {dims.distance && (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Ruler className="w-3.5 h-3.5 text-primary" />
              <span className="text-sm font-semibold">Distance</span>
            </div>
            <AccumulateToggle value={value.distance.accumulate} onChange={(v) => patchDistance({ accumulate: v })} />
          </div>
          {value.distance.accumulate === "daily" && (
            <div className="rounded-md border-2 border-border-strong bg-warning text-warning-foreground px-3.5 py-2.5 text-xs">
              Akumulasi harian: jarak semua kiriman 1 rider dalam 1 hari dijumlah dulu, baru dicocokkan ke band.
            </div>
          )}
          <RangeTableEditor rows={value.distance.rows} onChange={(rows) => patchDistance({ rows })} unit="km" />

          <ToggleBlock
            label="Surcharge Berat → Distance"
            hint="Berat kiriman lewat batas ini → fee Distance (di atas) baris itu dikali N. Weight (kalau aktif di bawah) tetap dihitung normal terpisah, gak ikut kena kali — berat di sini cuma pemicu."
            on={value.weight_surcharge.enabled}
            onToggle={(on) => patchWeightSurcharge({ enabled: on })}
          >
            <div className="grid grid-cols-2 gap-3 max-w-sm">
              <div className="flex flex-col gap-1.5">
                <FieldLabel>Batas Berat (kg)</FieldLabel>
                <TextInput
                  value={value.weight_surcharge.threshold_kg}
                  inputMode="decimal"
                  onChange={(e) => patchWeightSurcharge({ threshold_kg: sanitizeDecimalInput(e.target.value) })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <FieldLabel>Kali (mis. 2 = 2×)</FieldLabel>
                <TextInput
                  value={value.weight_surcharge.multiplier}
                  inputMode="decimal"
                  onChange={(e) => patchWeightSurcharge({ multiplier: sanitizeDecimalInput(e.target.value) })}
                />
              </div>
            </div>
          </ToggleBlock>
        </div>
      )}

      {dims.weight && (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-1.5">
              <Package className="w-3.5 h-3.5 text-primary" />
              <span className="text-sm font-semibold">Weight</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {([{ k: "range", l: "Range (Flat/Tier)" }, { k: "threshold_group", l: "Kelipatan per Store" }] as const).map(
                (opt) => (
                  <button
                    key={opt.k}
                    type="button"
                    onClick={() => patchWeight({ mode: opt.k })}
                    className={
                      "text-xs px-3 py-1.5 rounded-md border transition-colors " +
                      (value.weight.mode === opt.k
                        ? "bg-primary-soft text-primary-soft-foreground border-primary-border font-medium"
                        : "bg-card border-border text-muted-foreground hover:bg-muted")
                    }
                  >
                    {opt.l}
                  </button>
                ),
              )}
            </div>
          </div>

          {value.weight.mode === "range" ? (
            <>
              <div className="flex justify-end">
                <AccumulateToggle value={value.weight.accumulate} onChange={(v) => patchWeight({ accumulate: v })} />
              </div>
              {value.weight.accumulate === "daily" && (
                <div className="rounded-md border-2 border-border-strong bg-warning text-warning-foreground px-3.5 py-2.5 text-xs">
                  Akumulasi harian: berat semua kiriman 1 rider dalam 1 hari dijumlah dulu, baru dicocokkan ke band.
                </div>
              )}
              <RangeTableEditor rows={value.weight.rows} onChange={(rows) => patchWeight({ rows })} unit="kg" />
            </>
          ) : (
            <ThresholdGroupEditor value={value.weight.threshold} onChange={(threshold) => patchWeight({ threshold })} />
          )}
        </div>
      )}

      {/* Pengaturan lain — unit basis & cara penentuan rate untuk baris Flat */}
      <div className="rounded-md border border-border bg-card">
        <button
          type="button"
          onClick={() => setRateOpen((o) => !o)}
          className="w-full flex items-center justify-between px-3.5 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          Pengaturan lain (unit & rate untuk baris Flat)
          <span className="text-[11px]">{rateOpen ? "Tutup ▲" : "Buka ▼"}</span>
        </button>
        {rateOpen && (
          <div className="px-3.5 pb-3.5 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <FieldLabel>Unit dihitung (dedup & stop count)</FieldLabel>
                <select
                  value={value.unit_basis}
                  onChange={(e) => onChange({ ...value, unit_basis: e.target.value as "awb" | "unique_address" })}
                  className="w-full text-sm rounded-md border border-border bg-card px-2.5 py-1.5"
                >
                  <option value="awb">Per kiriman (AWB)</option>
                  <option value="unique_address">Per alamat unik</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <FieldLabel>Rate baris Flat ditentukan dari</FieldLabel>
                <select
                  value={value.rate_by}
                  onChange={(e) => onChange({ ...value, rate_by: e.target.value as "flat" | "column" | "delivery_type" })}
                  className="w-full text-sm rounded-md border border-border bg-card px-2.5 py-1.5"
                >
                  <option value="flat">Flat (base_fee band, tanpa override)</option>
                  <option value="column">Beda per kolom (mis. Area)</option>
                  <option value="delivery_type">Antar / Kembali</option>
                </select>
              </div>
            </div>

            {value.rate_by !== "flat" && (
              <>
                {value.rate_by === "column" && (
                  <div className="flex flex-col gap-1.5 max-w-xs">
                    <FieldLabel>Nama Kolom</FieldLabel>
                    <select
                      value={value.match_column}
                      onChange={(e) => onChange({ ...value, match_column: e.target.value })}
                      className="w-full text-sm rounded-md border border-border bg-card px-2.5 py-1.5"
                    >
                      {MATCH_COLUMN_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>{opt === "Area" ? "Area / Kota (District)" : "Tipe Layanan (Service Type)"}</option>
                      ))}
                    </select>
                  </div>
                )}
                <TableShell head={<>
                  <Th>{value.rate_by === "delivery_type" ? "Nilai (DELIVERY / RETURN)" : "Nilai Kolom (cth: Jakarta Pusat)"}</Th>
                  <Th className="w-44">Tarif (Rp)</Th>
                  <Th className="w-10" />
                </>}>
                  {value.rates.map((r, i) => (
                    <tr key={i} className="border-t border-border/60">
                      <Td>
                        <TextInput
                          value={r.key}
                          onChange={(e) =>
                            onChange({ ...value, rates: value.rates.map((x, idx) => (idx === i ? { ...x, key: e.target.value } : x)) })
                          }
                        />
                      </Td>
                      <Td>
                        <RupiahInput
                          value={r.rate}
                          onChange={(v) =>
                            onChange({ ...value, rates: value.rates.map((x, idx) => (idx === i ? { ...x, rate: v } : x)) })
                          }
                        />
                      </Td>
                      <Td className="text-center">
                        <RowDeleteBtn onClick={() => onChange({ ...value, rates: value.rates.filter((_, idx) => idx !== i) })} />
                      </Td>
                    </tr>
                  ))}
                </TableShell>
                <AddRowBtn onClick={() => onChange({ ...value, rates: [...value.rates, { key: "", rate: "" }] })}>
                  Tambah Baris
                </AddRowBtn>
                {noDims && (
                  <div className="flex flex-col gap-1.5 max-w-xs">
                    <FieldLabel>Rate Default (kalau gak ke-match baris manapun)</FieldLabel>
                    <RupiahInput
                      value={value.default_rate}
                      onChange={(v) => onChange({ ...value, default_rate: v })}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Dipakai kalau nilai kolomnya (mis. district) gak cocok satu pun baris di atas — biar gak diam-diam
                      jadi Rp0. Kosongkan/0 kalau memang mau tetap Rp0.
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
