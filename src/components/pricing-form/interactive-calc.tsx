// Kalkulator interaktif — preview hasil hitung tanpa perlu commit data.
// Sudah cukup berdiri sendiri di kode lama, dipindah nyaris apa adanya
// (cuma nama field "calcType" 6-way diganti jadi kombinasi category+subtype).
import { useEffect, useMemo, useState } from "react";
import { Calculator } from "lucide-react";
import { useT } from "@/lib/i18n";
import type { PricingCategory, PricingSubtype, SchemeFor, PricingEnvelope, DeliveryDimensions } from "@/lib/pricing-types";
import { calcAttendanceScheme, bandLookupFee } from "@/lib/pricing-calc";
import { formatRupiah, parseRupiah } from "@/lib/format";
import { type DeliveryState, type RangeRowState } from "./delivery-fields";
import type { RangeRow } from "@/lib/pricing-types";
import { type AttendanceState, buildAttendanceConfig } from "./attendance-fields";
import { type ExStep } from "./shared";

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

function numericRows(rows: RangeRowState[]): RangeRow[] {
  return rows.map((r) => ({
    type: r.type,
    from: Number(r.from) || 0,
    to: r.to.trim() === "" ? null : Number(r.to),
    base_fee: parseRupiah(r.base_fee),
    step: r.type === "tier" ? Number(r.step) || 1 : 0,
    add_per_step: r.type === "tier" ? parseRupiah(r.add_per_step) : 0,
  }));
}

export interface WorkedExample {
  steps: ExStep[];
  total: { label: string; amount: number };
  notes: string[];
}

export interface CalcInputs {
  units: string;
  area: string;
  distance: string;
  weight: string;
  totalKg: string;
  hours: string;
  isLate: boolean;
}

export interface InteractiveCalcProps {
  category: PricingCategory;
  subtype: PricingSubtype;
  delivery: DeliveryState;
  attendance: AttendanceState;
  schemeFor: SchemeFor;
  addKgOn: boolean;
  multiDropOn: boolean;
  multiDropFee: string;
  billingOn: boolean;
}

export function defaultCalcInputs(p: InteractiveCalcProps): CalcInputs {
  const firstDistTo = Number(p.delivery.distance.rows[0]?.to) || 5;
  const firstWeightTo = Number(p.delivery.weight.rows[0]?.to) || 5;
  return {
    units: "3",
    area: p.delivery.rates.find((r) => r.key.trim())?.key ?? "",
    distance: String(firstDistTo + 3),
    weight: String(firstWeightTo + 3),
    totalKg: String((Number(p.delivery.weight.threshold.default_threshold) || 10) * 2 + 1),
    hours: p.attendance.standard_hours || "8",
    isLate: false,
  };
}

export function computeInteractive(p: InteractiveCalcProps, inp: CalcInputs): WorkedExample {
  const notes: string[] = [];
  const dims = (p.subtype as DeliveryDimensions) || { distance: false, weight: false };
  const modNotes = () => {
    if (p.category === "delivery" && p.addKgOn) notes.push("Add-KG nyala: biaya berat ditambah DI ATAS hasil ini.");
    if (p.multiDropOn)
      notes.push(`Multi-drop nyala: kiriman ke-2 dst +${formatRupiah(parseRupiah(p.multiDropFee))} per kiriman.`);
    if (p.schemeFor === "client" && p.billingOn)
      notes.push("Billing add-ons belum termasuk di sini (min charge / admin fee / PPN).");
  };

  if (p.category === "delivery" && (dims.distance || dims.weight)) {
    const steps: ExStep[] = [];
    let total = 0;

    // Rate override PER BARIS (kolom/delivery-return), bukan per-dimensi — sama
    // kayak calcModularDeliveryComponent di pricing-calc.ts. Kalau match, itu
    // GANTI total fee baris ini, dipakai sekali doang oleh dimensi pertama yang
    // aktif — bukan ditambahin ke distance MAUPUN weight (dulu bug: baris yang
    // match di dua-duanya dobel-charge, lihat regresi Wicked Pies).
    // rate_by="delivery_type" match-nya BUKAN ke inp.area (itu match_column
    // "Area"/kolom biasa) — di mesin asli (resolveRateHit, pricing-calc.ts)
    // dicoba dulu ke delivery_type baris (DELIVERY/RETURN), baru fallback ke
    // district. Preview ini simulasiin order NORMAL ("Delivery"), jadi rate
    // "Return" (kalau ada) sengaja gak match — tanpa ini, skema yang punya
    // override "Return" bakal kekunci ke situ dan Distance/Weight kelihatan
    // kayak gak ngaruh sama sekali (kejadian di Komu Komu Bakehouse).
    const overrideMatchValue = p.delivery.rate_by === "delivery_type" ? "Delivery" : inp.area;
    const overrideHit = p.delivery.rate_by !== "flat" ? p.delivery.rates.find((r) => norm(r.key) === norm(overrideMatchValue)) : undefined;
    let overrideUsed = false;
    const consumeOverride = (): number | null => {
      if (!overrideHit || overrideUsed) return null;
      overrideUsed = true;
      return parseRupiah(overrideHit.rate);
    };

    if (dims.distance) {
      const km = Number(inp.distance) || 0;
      const { fee: bandFee, band } = bandLookupFee(numericRows(p.delivery.distance.rows), km);
      const overrideFee = consumeOverride();
      let fee = overrideFee ?? bandFee;
      // Surcharge berat → Distance: berat (dari input Weight kalau dimensi itu
      // aktif juga, atau dari input khusus di bawah kalau enggak) lewat batas
      // → fee Distance ini dikali N. Sama kayak calcModularDeliveryComponent.
      const ws = p.delivery.weight_surcharge;
      const wKg = Number(inp.weight || inp.totalKg) || 0;
      const surcharged = ws?.enabled && wKg >= (Number(ws.threshold_kg) || 0);
      if (surcharged) fee *= Number(ws.multiplier) || 1;
      steps.push({
        text: `Distance: ${km} km → band ${band ? `[${band.from}-${band.to ?? "∞"}) (${band.type})` : "(tidak ada band cocok)"}${overrideFee != null ? ` (rate override: ${inp.area})` : ""}${surcharged ? ` × ${ws!.multiplier} (berat ${wKg}kg ≥ ${ws!.threshold_kg}kg)` : ""}`,
        amount: fee,
      });
      total += fee;
    }

    if (dims.weight) {
      const kg = Number(inp.weight || inp.totalKg) || 0;
      if (p.delivery.weight.mode === "threshold_group") {
        const th = p.delivery.weight.threshold;
        const t = Number(th.default_threshold) || 0;
        const rate = parseRupiah(th.default_rate);
        const mult = t > 0 ? Math.ceil(kg / t) : 0;
        const fee = mult * rate;
        steps.push({ text: `Weight (kelipatan): ${kg} kg ÷ ${t} → dibulatkan ke atas ${mult}× × ${formatRupiah(rate)}`, amount: fee });
        total += fee;
      } else {
        const { fee: bandFee, band } = bandLookupFee(numericRows(p.delivery.weight.rows), kg);
        const overrideFee = consumeOverride();
        const fee = overrideFee ?? bandFee;
        steps.push({
          text: `Weight: ${kg} kg → band ${band ? `[${band.from}-${band.to ?? "∞"}) (${band.type})` : "(tidak ada band cocok)"}${overrideFee != null ? ` (rate override: ${inp.area})` : ""}`,
          amount: fee,
        });
        total += fee;
      }
    }

    if (dims.distance && dims.weight) notes.push("Distance + Weight dijumlah (kecuali salah satunya kena rate override — itu gantiin totalnya, gak ditambah).");
    modNotes();
    return { steps, total: { label: "Total", amount: total }, notes };
  }

  // Distance/Weight dua-duanya OFF — skema flat murni dibedain per kolom/
  // delivery-type (sama seperti fallback di calcModularDeliveryComponent,
  // pricing-calc.ts). Sebelumnya preview ini jatuh ke fallback 0 di bawah
  // walau skemanya beneran ngitung tarif kalau di-Save.
  if (p.category === "delivery" && !dims.distance && !dims.weight) {
    const steps: ExStep[] = [];
    let total = 0;
    if (p.delivery.rate_by !== "flat") {
      // Sama kayak override di atas: rate_by="delivery_type" match ke tipe
      // order (DELIVERY/RETURN), bukan ke inp.area — preview simulasiin
      // order NORMAL ("Delivery").
      const matchValue = p.delivery.rate_by === "delivery_type" ? "Delivery" : inp.area;
      const hit = p.delivery.rates.find((r) => norm(r.key) === norm(matchValue));
      const fee = hit ? parseRupiah(hit.rate) : parseRupiah(p.delivery.default_rate ?? "0");
      steps.push({
        text: `Flat per ${p.delivery.rate_by === "delivery_type" ? "Antar/Kembali" : "kolom"}: "${matchValue}"${hit ? "" : " (tidak ada tarif cocok, pakai rate default)"}`,
        amount: fee,
      });
      total += fee;
    } else {
      steps.push({ text: "Rate baris Flat masih 'Flat' — belum ada tarif buat diterapin tanpa Distance/Weight.", amount: 0 });
    }
    modNotes();
    return { steps, total: { label: "Total", amount: total }, notes };
  }

  if (p.category === "attendance") {
    const a = p.attendance;
    const env: PricingEnvelope = { version: 1, type: "attendance", config: buildAttendanceConfig(a), add_kg: null, multi_drop: null, billing_addons: null };
    const std = Number(a.standard_hours) || 0;
    const actualMin = Math.round((Number(inp.hours) || 0) * 60);
    const res = calcAttendanceScheme(env, [{ log_date: "2026-01-01", duration_minutes: actualMin, is_late: inp.isLate, is_absent: false }]);
    const row = res.perRow[0];
    const full = parseRupiah(a.full_fee);
    const pct = std > 0 ? Math.min(100, Math.round(((Number(inp.hours) || 0) / std) * 100)) : 100;
    const steps: ExStep[] = [
      { text: `Fee penuh per shift`, amount: full },
      { text: `Kerja ${inp.hours} dari ${std} jam (${pct}%) → fee dasar`, amount: row?.base ?? 0 },
    ];
    if ((row?.overtime ?? 0) > 0) steps.push({ text: "Lembur", amount: row.overtime });
    a.incentives.filter((c) => c.label.trim()).forEach((c) => {
      const amt = parseRupiah(c.amount);
      const cair = c.condition === "always" || (c.condition === "ontime_only" && !inp.isLate);
      steps.push({ text: `+ ${c.label} ${c.condition === "always" ? "(selalu)" : inp.isLate ? "(LATE — tidak cair)" : "(ONTIME ✓)"}`, amount: cair ? amt : 0 });
    });
    return { steps, total: { label: "Fee hari itu", amount: row?.fee ?? 0 }, notes };
  }

  return { steps: [], total: { label: "Total", amount: 0 }, notes: [] };
}

// Input jarak/berat buat kategori delivery — dipakai InteractiveCalc DAN
// RevenueShareCalc (revenue-share-calc.tsx, kalkulator revenue skema Client
// buat preview Revenue Share), biar gak duplikat markup input yang sama.
export function DeliveryCalcInputs({
  props,
  inp,
  onChange,
}: {
  props: InteractiveCalcProps;
  inp: CalcInputs;
  onChange: (p: Partial<CalcInputs>) => void;
}) {
  const { t } = useT();
  const dims = (props.subtype as { distance: boolean; weight: boolean }) || { distance: false, weight: false };
  return (
    <div className="flex flex-wrap gap-3">
      {dims.distance && (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] text-muted-foreground">{props.delivery.distance.accumulate === "daily" ? t("pfCalc.totalDistanceToday") : t("pfCalc.distanceKm")}</span>
          <input type="number" min="0" step="0.1" value={inp.distance} onChange={(e) => onChange({ distance: e.target.value })}
            className="w-24 text-xs rounded border border-border bg-card px-2 py-1.5" />
        </div>
      )}
      {dims.weight && props.delivery.weight.mode === "range" && (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] text-muted-foreground">{props.delivery.weight.accumulate === "daily" ? t("pfCalc.totalWeightToday") : t("pfCalc.weightKg")}</span>
          <input type="number" min="0" step="0.1" value={inp.weight} onChange={(e) => onChange({ weight: e.target.value })}
            className="w-24 text-xs rounded border border-border bg-card px-2 py-1.5" />
        </div>
      )}
      {!dims.weight && props.delivery.weight_surcharge?.enabled && (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] text-muted-foreground">{t("pfCalc.weightSurchargeTrigger")}</span>
          <input type="number" min="0" step="0.1" value={inp.weight} onChange={(e) => onChange({ weight: e.target.value })}
            className="w-24 text-xs rounded border border-border bg-card px-2 py-1.5" />
        </div>
      )}
      {dims.weight && props.delivery.weight.mode === "threshold_group" && (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] text-muted-foreground">{t("pfCalc.totalGroupWeight")}</span>
          <input type="number" min="0" step="0.1" value={inp.totalKg} onChange={(e) => onChange({ totalKg: e.target.value })}
            className="w-28 text-xs rounded border border-border bg-card px-2 py-1.5" />
        </div>
      )}
    </div>
  );
}

export function InteractiveCalc(props: InteractiveCalcProps) {
  const { t } = useT();
  const [inp, setInp] = useState<CalcInputs>(() => defaultCalcInputs(props));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setInp(defaultCalcInputs(props)); }, [props.category, props.subtype]);

  const p = (patch: Partial<CalcInputs>) => setInp((prev) => ({ ...prev, ...patch }));
  const result = useMemo(() => computeInteractive(props, inp), [props, inp]);
  return (
    <div className="rounded-md border-2 border-border-strong bg-card shadow-[3px_3px_0_0_var(--color-border-strong)] px-4 py-3.5 mt-4">
      <div className="flex items-center gap-2 mb-3">
        <Calculator className="w-4 h-4 text-primary" />
        <p className="text-xs font-semibold text-foreground">{t("pfCalc.title")}</p>
        <span className="text-[10px] text-muted-foreground">{t("pfCalc.autoUpdateHint")}</span>
      </div>

      {/* ── Inputs per tipe ── */}
      <div className="mb-3.5 space-y-2">
        {props.category === "delivery" && <DeliveryCalcInputs props={props} inp={inp} onChange={p} />}

        {props.category === "attendance" && (
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex flex-col gap-1">
              <span className="text-[11px] text-muted-foreground">{t("pfCalc.workHours")}</span>
              <input type="number" min="0" step="0.5" value={inp.hours} onChange={(e) => p({ hours: e.target.value })}
                className="w-20 text-xs rounded border border-border bg-card px-2 py-1.5" />
            </div>
            <div className="flex gap-1 pb-0.5">
              {([{ v: false, l: t("pfCalc.ontime") }, { v: true, l: t("pfCalc.late") }] as const).map((opt) => (
                <button key={String(opt.v)} type="button" onClick={() => p({ isLate: opt.v })}
                  className={"text-xs px-2.5 py-1.5 rounded border-2 border-border-strong transition-colors " +
                    (inp.isLate === opt.v ? "bg-primary text-primary-foreground shadow-[3px_3px_0_0_var(--color-border-strong)] font-medium" : "bg-card text-foreground hover:bg-muted")}>
                  {opt.l}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Result ── */}
      <div className="border-t border-border-strong pt-2.5 space-y-1">
        {result.steps.map((s, i) => (
          <div key={i} className="flex items-baseline justify-between gap-3 text-xs">
            <span className="text-muted-foreground">{s.text}</span>
            {s.amount !== undefined && <span className="font-medium tabular-nums whitespace-nowrap">{formatRupiah(s.amount)}</span>}
          </div>
        ))}
        <div className="flex items-center justify-between gap-3 mt-2 pt-2 border-t border-border-strong">
          <span className="text-xs font-semibold">{result.total.label}</span>
          <span className="text-base font-bold text-primary tabular-nums">{formatRupiah(result.total.amount)}</span>
        </div>
        {result.notes.length > 0 && (
          <ul className="mt-2 space-y-0.5">
            {result.notes.map((n, i) => (
              <li key={i} className="text-[11px] text-muted-foreground flex gap-1.5">
                <span className="text-primary flex-shrink-0">•</span><span>{n}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
