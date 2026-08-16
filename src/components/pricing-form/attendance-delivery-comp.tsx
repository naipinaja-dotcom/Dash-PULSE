// Sub-form: komponen per kiriman di dalam skema Per Kehadiran.
// Menggantikan kategori "Kombinasi" lama — semua method valid (flat/tier/threshold),
// bukan cuma tier.
import { parseRupiah } from "@/lib/format";
import { useT } from "@/lib/i18n";
import type { LangKey } from "@/lib/translations";
import {
  AddRowBtn, FieldLabel, RupiahInput, StepTierEditor, Td, TableShell,
  TextInput, Th, RowDeleteBtn, buildStepTier, stepTierToState, emptyStepTier,
  RESOLVABLE_COLUMN_OPTIONS, resolvableColumnLabel,
  type StepTierState,
} from "./shared";

// Ketik bebas selain 3 pilihan di RESOLVABLE_COLUMN_OPTIONS diam-diam
// fallback ke Area/district di resolveField() (pricing-calc.ts) — termasuk
// default lama "sender_name" yang gak pernah beneran match apa pun. Normalize
// biar skema lama yang kepalanjur kesimpen begitu tetap kebaca konsisten
// dengan behavior aslinya (yang emang udah jadi Area selama ini).
function normalizeResolvableColumn(v: unknown): (typeof RESOLVABLE_COLUMN_OPTIONS)[number] {
  return (RESOLVABLE_COLUMN_OPTIONS as readonly string[]).includes(v as string)
    ? (v as (typeof RESOLVABLE_COLUMN_OPTIONS)[number])
    : "Area";
}

export type DeliveryCompMethod = "flat" | "tier" | "threshold";

export interface AttendanceDeliveryCompState {
  method: DeliveryCompMethod;
  // --- tier ---
  orderBy: "distance" | "weight";
  orderTier: StepTierState;
  // --- flat ---
  unit: "awb" | "unique_address";
  rateBy: "flat" | "column";
  flatRate: string;
  matchColumn: string;
  rates: { key: string; rate: string }[];
  defaultRate: string;
  // --- threshold ---
  groupBy: string;
  defaultThreshold: string;
  defaultRateThreshold: string;
  thresholdRules: { key: string; threshold: string; rate: string }[];
}

export function emptyDeliveryCompState(): AttendanceDeliveryCompState {
  return {
    method: "tier",
    orderBy: "distance",
    orderTier: emptyStepTier(),
    unit: "awb",
    rateBy: "flat",
    flatRate: "3000",
    matchColumn: "Delivery Type",
    rates: [],
    defaultRate: "3000",
    groupBy: "Area",
    defaultThreshold: "10",
    defaultRateThreshold: "5000",
    thresholdRules: [],
  };
}

export function buildDeliveryCompConfig(s: AttendanceDeliveryCompState): Record<string, unknown> {
  const base: Record<string, unknown> = { enabled: true, method: s.method };
  if (s.method === "tier") {
    return {
      ...base,
      window: "daily_rider",
      order_by: s.orderBy,
      order_tier: buildStepTier(s.orderTier),
    };
  }
  if (s.method === "flat") {
    return {
      ...base,
      window: "per_row",
      unit: s.unit,
      rate_by: s.rateBy,
      flat_rate: parseRupiah(s.flatRate),
      match_column: s.matchColumn,
      rates: s.rates.filter((r) => r.key.trim()).map((r) => ({ key: r.key.trim(), rate: parseRupiah(r.rate) })),
      default_rate: parseRupiah(s.defaultRate),
    };
  }
  // threshold
  return {
    ...base,
    window: "daily_store",
    group_by: s.groupBy || "Area",
    default: { threshold: Number(s.defaultThreshold) || 0, rate: parseRupiah(s.defaultRateThreshold) },
    rules: s.thresholdRules.filter((r) => r.key.trim()).map((r) => ({ key: r.key.trim(), threshold: Number(r.threshold) || 0, rate: parseRupiah(r.rate) })),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function loadDeliveryCompState(c: any): AttendanceDeliveryCompState {
  const s = emptyDeliveryCompState();
  if (!c) return s;
  s.method = c.method === "flat" ? "flat" : c.method === "threshold" ? "threshold" : "tier";
  // tier
  s.orderBy = c.order_by === "weight" ? "weight" : "distance";
  s.orderTier = stepTierToState(c.order_tier);
  // flat
  s.unit = c.unit === "unique_address" ? "unique_address" : "awb";
  s.rateBy = c.rate_by === "flat" ? "flat" : "column";
  s.flatRate = String(c.flat_rate ?? "");
  s.matchColumn = normalizeResolvableColumn(c.match_column ?? "Delivery Type");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  s.rates = (c.rates ?? []).map((r: any) => ({ key: r.key ?? "", rate: String(r.rate ?? "") }));
  s.defaultRate = String(c.default_rate ?? "");
  // threshold
  s.groupBy = normalizeResolvableColumn(c.group_by ?? "Area");
  s.defaultThreshold = String(c.default?.threshold ?? "");
  s.defaultRateThreshold = String(c.default?.rate ?? "");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  s.thresholdRules = (c.rules ?? []).map((r: any) => ({ key: r.key ?? "", threshold: String(r.threshold ?? ""), rate: String(r.rate ?? "") }));
  return s;
}

const METHOD_TABS: { k: DeliveryCompMethod; labelKey: LangKey }[] = [
  { k: "tier", labelKey: "pfAttDelivComp.methodTier" },
  { k: "flat", labelKey: "pfAttDelivComp.methodFlat" },
  { k: "threshold", labelKey: "pfAttDelivComp.methodThreshold" },
];

export function AttendanceDeliveryCompFields({
  value,
  onChange,
}: {
  value: AttendanceDeliveryCompState;
  onChange: (v: AttendanceDeliveryCompState) => void;
}) {
  const { t } = useT();
  const patch = (p: Partial<AttendanceDeliveryCompState>) => onChange({ ...value, ...p });

  return (
    <div className="space-y-4 pt-2">
      {/* Method selector */}
      <div>
        <p className="text-xs font-medium text-muted-foreground mb-2">{t("pfAttDelivComp.methodLabel")}</p>
        <div className="flex gap-1.5 flex-wrap">
          {METHOD_TABS.map((opt) => (
            <button
              key={opt.k}
              type="button"
              onClick={() => patch({ method: opt.k })}
              className={
                "text-xs px-3 py-1.5 rounded-md border-2 border-border-strong transition-colors " +
                (value.method === opt.k
                  ? "bg-primary text-primary-foreground shadow-[3px_3px_0_0_var(--color-border-strong)] font-medium"
                  : "bg-card text-foreground hover:bg-muted")
              }
            >
              {t(opt.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {/* ---- TIER ---- */}
      {value.method === "tier" && (
        <div className="space-y-3">
          <div className="flex gap-1.5">
            {([{ k: "distance", labelKey: "pfAttDelivComp.orderByDistance" }, { k: "weight", labelKey: "pfAttDelivComp.orderByWeight" }] as const).map((opt) => (
              <button key={opt.k} type="button" onClick={() => patch({ orderBy: opt.k })}
                className={"text-xs px-3 py-1.5 rounded-md border-2 border-border-strong transition-colors " + (value.orderBy === opt.k ? "bg-primary text-primary-foreground shadow-[3px_3px_0_0_var(--color-border-strong)] font-medium" : "bg-card text-foreground hover:bg-muted")}>
                {t(opt.labelKey)}
              </button>
            ))}
          </div>
          <StepTierEditor unit={value.orderBy === "weight" ? "kg" : "km"} value={value.orderTier} onChange={(v) => patch({ orderTier: v })} />
          <p className="text-[11px] text-muted-foreground">{t("pfAttDelivComp.tierHintPrefix")} {value.orderBy === "weight" ? t("pfAttDelivComp.byWeight") : t("pfAttDelivComp.byDistance")}{t("pfAttDelivComp.tierHintSuffix")}</p>
        </div>
      )}

      {/* ---- FLAT ---- */}
      {value.method === "flat" && (
        <div className="space-y-3">
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1.5">{t("pfAttDelivComp.unitLabel")}</p>
            <div className="flex gap-1.5">
              {([{ k: "awb", labelKey: "pfAttDelivComp.unitAwb" }, { k: "unique_address", labelKey: "pfAttDelivComp.unitUniqueAddress" }] as const).map((opt) => (
                <button key={opt.k} type="button" onClick={() => patch({ unit: opt.k })}
                  className={"text-xs px-3 py-1.5 rounded-md border-2 border-border-strong transition-colors " + (value.unit === opt.k ? "bg-primary text-primary-foreground shadow-[3px_3px_0_0_var(--color-border-strong)] font-medium" : "bg-card text-foreground hover:bg-muted")}>
                  {t(opt.labelKey)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1.5">{t("pfAttDelivComp.rateLabel")}</p>
            <div className="flex gap-1.5 mb-2">
              {([{ k: "flat", labelKey: "pfAttDelivComp.rateByFlat" }, { k: "column", labelKey: "pfAttDelivComp.rateByColumn" }] as const).map((opt) => (
                <button key={opt.k} type="button" onClick={() => patch({ rateBy: opt.k })}
                  className={"text-xs px-3 py-1.5 rounded-md border-2 border-border-strong transition-colors " + (value.rateBy === opt.k ? "bg-primary text-primary-foreground shadow-[3px_3px_0_0_var(--color-border-strong)] font-medium" : "bg-card text-foreground hover:bg-muted")}>
                  {t(opt.labelKey)}
                </button>
              ))}
            </div>
            {value.rateBy === "flat" ? (
              <div className="max-w-xs flex flex-col gap-1.5">
                <FieldLabel>{t("pfAttDelivComp.flatRatePerDelivery")}</FieldLabel>
                <RupiahInput value={value.flatRate} onChange={(v) => patch({ flatRate: v })} />
              </div>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-3 max-w-sm">
                  <div className="flex flex-col gap-1.5">
                    <FieldLabel>{t("pfAttDelivComp.matchColumnLabel")}</FieldLabel>
                    <select
                      value={value.matchColumn}
                      onChange={(e) => patch({ matchColumn: e.target.value })}
                      className="w-full text-sm rounded-md border border-border bg-card px-2.5 py-1.5"
                    >
                      {RESOLVABLE_COLUMN_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>{resolvableColumnLabel(opt)}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <FieldLabel>{t("pfAttDelivComp.defaultRateLabel")}</FieldLabel>
                    <RupiahInput value={value.defaultRate} onChange={(v) => patch({ defaultRate: v })} />
                  </div>
                </div>
                <TableShell head={<><Th>{t("pfAttDelivComp.colValue")}</Th><Th className="w-36">{t("pfAttDelivComp.colRate")}</Th><Th className="w-10" /></>}>
                  {value.rates.map((r, i) => (
                    <tr key={i} className="border-t border-border/60">
                      <Td><TextInput value={r.key} onChange={(e) => patch({ rates: value.rates.map((x, idx) => idx === i ? { ...x, key: e.target.value } : x) })} /></Td>
                      <Td><RupiahInput value={r.rate} onChange={(v) => patch({ rates: value.rates.map((x, idx) => idx === i ? { ...x, rate: v } : x) })} /></Td>
                      <Td><RowDeleteBtn onClick={() => patch({ rates: value.rates.filter((_, idx) => idx !== i) })} /></Td>
                    </tr>
                  ))}
                </TableShell>
                <AddRowBtn onClick={() => patch({ rates: [...value.rates, { key: "", rate: "" }] })}>{t("pfAttDelivComp.addRate")}</AddRowBtn>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ---- THRESHOLD ---- */}
      {value.method === "threshold" && (
        <div className="space-y-3">
          <div className="max-w-xs flex flex-col gap-1.5">
            <FieldLabel>{t("pfAttDelivComp.groupByLabel")}</FieldLabel>
            <select
              value={value.groupBy}
              onChange={(e) => patch({ groupBy: e.target.value })}
              className="w-full text-sm rounded-md border border-border bg-card px-2.5 py-1.5"
            >
              {RESOLVABLE_COLUMN_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{resolvableColumnLabel(opt)}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3 max-w-sm">
            <div className="flex flex-col gap-1.5">
              <FieldLabel>{t("pfAttDelivComp.defaultThresholdLabel")}</FieldLabel>
              <TextInput type="number" value={value.defaultThreshold} onChange={(e) => patch({ defaultThreshold: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1.5">
              <FieldLabel>{t("pfAttDelivComp.defaultRateThresholdLabel")}</FieldLabel>
              <RupiahInput value={value.defaultRateThreshold} onChange={(v) => patch({ defaultRateThreshold: v })} />
            </div>
          </div>
          <TableShell head={<><Th>{t("pfAttDelivComp.colStoreArea")}</Th><Th className="w-32">{t("pfAttDelivComp.colThreshold")}</Th><Th className="w-36">{t("pfAttDelivComp.colRateRp")}</Th><Th className="w-10" /></>}>
            {value.thresholdRules.map((r, i) => (
              <tr key={i} className="border-t border-border/60">
                <Td><TextInput value={r.key} onChange={(e) => patch({ thresholdRules: value.thresholdRules.map((x, idx) => idx === i ? { ...x, key: e.target.value } : x) })} /></Td>
                <Td><TextInput type="number" value={r.threshold} onChange={(e) => patch({ thresholdRules: value.thresholdRules.map((x, idx) => idx === i ? { ...x, threshold: e.target.value } : x) })} /></Td>
                <Td><RupiahInput value={r.rate} onChange={(v) => patch({ thresholdRules: value.thresholdRules.map((x, idx) => idx === i ? { ...x, rate: v } : x) })} /></Td>
                <Td><RowDeleteBtn onClick={() => patch({ thresholdRules: value.thresholdRules.filter((_, idx) => idx !== i) })} /></Td>
              </tr>
            ))}
          </TableShell>
          <AddRowBtn onClick={() => patch({ thresholdRules: [...value.thresholdRules, { key: "", threshold: "", rate: "" }] })}>{t("pfAttDelivComp.addRule")}</AddRowBtn>
          <p className="text-[11px] text-muted-foreground">{t("pfAttDelivComp.thresholdHint")}</p>
        </div>
      )}
    </div>
  );
}
