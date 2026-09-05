// Area City Pricing — rule tarif per City MGMT (meta.city, BUKAN district).
// State form <-> AreaCityPricing envelope. Pola sama seperti delivery-fields.tsx/
// attendance-fields.tsx: state semua string (di-parse saat build), 1 komponen render.
import type { AreaCityPricing, AreaPricingRule } from "@/lib/pricing-types";
import { parseRupiah } from "@/lib/format";
import { Plus, Trash2 } from "lucide-react";
import { useT } from "@/lib/i18n";
import { FieldLabel, TextInput, RupiahInput } from "./shared";

export interface AreaRuleState {
  id: string;
  name: string;
  citiesRaw: string; // ketik bebas, dipisah koma — diparse jadi array saat build
  model: "flat" | "per_km";
  rate: string;
  minimum_fee: string;
}

export interface AreaCityState {
  rules: AreaRuleState[];
}

export function emptyAreaCityState(): AreaCityState {
  return { rules: [] };
}

function newRuleId(): string {
  return `area_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function citiesFromRaw(raw: string): string[] {
  return raw
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

export function buildAreaCityConfig(state: AreaCityState, enabled: boolean): AreaCityPricing {
  const rules: AreaPricingRule[] = state.rules.map((r) => ({
    id: r.id,
    name: r.name.trim(),
    cities: citiesFromRaw(r.citiesRaw),
    model: r.model,
    rate: parseRupiah(r.rate),
    minimum_fee: r.model === "per_km" ? parseRupiah(r.minimum_fee) : 0,
  }));
  return { enabled, rules };
}

export function loadAreaCityState(acp: AreaCityPricing | null | undefined): AreaCityState {
  if (!acp) return emptyAreaCityState();
  return {
    rules: acp.rules.map((r) => ({
      id: r.id,
      name: r.name,
      citiesRaw: r.cities.join(", "),
      model: r.model,
      rate: String(r.rate ?? ""),
      minimum_fee: String(r.minimum_fee ?? ""),
    })),
  };
}

// Validasi sebelum save (aturan bisnis PRD): tiap rule butuh nama, minimal 1
// City, dan rate > 0; 1 City gak boleh nyantol di lebih dari 1 rule (dalam
// scheme yang sama). Return pesan error pertama yang ketemu, atau null kalau valid.
export function validateAreaCityState(state: AreaCityState): string | null {
  if (state.rules.length === 0) return "Area City Pricing aktif tapi belum ada rule — tambah minimal 1 area atau matikan toggle-nya.";
  const seenCities = new Map<string, string>(); // normalized city -> rule name
  for (const r of state.rules) {
    const name = r.name.trim();
    if (!name) return "Setiap rule area butuh nama.";
    const cities = citiesFromRaw(r.citiesRaw);
    if (cities.length === 0) return `Rule "${name}" belum punya City — isi minimal 1 City MGMT.`;
    if (!(parseRupiah(r.rate) > 0)) return `Rule "${name}" belum punya tarif (rate).`;
    for (const c of cities) {
      const key = c.trim().toLowerCase();
      const prevOwner = seenCities.get(key);
      if (prevOwner && prevOwner !== name) return `City "${c}" dipakai di lebih dari satu rule ("${prevOwner}" dan "${name}").`;
      seenCities.set(key, name);
    }
  }
  return null;
}

export function AreaCityFields({ value, onChange }: { value: AreaCityState; onChange: (v: AreaCityState) => void }) {
  const { t } = useT();
  const setRule = (i: number, patch: Partial<AreaRuleState>) =>
    onChange({ rules: value.rules.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) });
  const addRule = () =>
    onChange({
      rules: [...value.rules, { id: newRuleId(), name: "", citiesRaw: "", model: "flat", rate: "", minimum_fee: "" }],
    });
  const delRule = (i: number) => onChange({ rules: value.rules.filter((_, idx) => idx !== i) });

  return (
    <div className="flex flex-col gap-3">
      {value.rules.length === 0 && (
        <p className="text-xs text-muted-foreground">{t("pfAreaCity.empty")}</p>
      )}
      {value.rules.map((r, i) => (
        <div key={r.id} className="rounded-md border border-border bg-background p-3 flex flex-col gap-2.5">
          <div className="flex items-start gap-2">
            <div className="flex-1 flex flex-col gap-1.5">
              <FieldLabel>{t("pfAreaCity.areaName")}</FieldLabel>
              <TextInput value={r.name} placeholder={t("pfAreaCity.areaNamePlaceholder")} onChange={(e) => setRule(i, { name: e.target.value })} />
            </div>
            <button type="button" onClick={() => delRule(i)} className="mt-5 p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-muted flex-shrink-0">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel>{t("pfAreaCity.cities")}</FieldLabel>
            <span className="text-[11px] text-muted-foreground leading-snug">{t("pfAreaCity.citiesHint")}</span>
            <TextInput
              value={r.citiesRaw}
              placeholder={t("pfAreaCity.citiesPlaceholder")}
              onChange={(e) => setRule(i, { citiesRaw: e.target.value })}
              className="mt-0.5"
            />
          </div>
          <div className="flex gap-2">
            <div className="flex flex-col gap-1.5">
              <FieldLabel>{t("pfAreaCity.model")}</FieldLabel>
              <select
                value={r.model}
                onChange={(e) => setRule(i, { model: e.target.value as "flat" | "per_km" })}
                className="rounded-md border-2 border-border-strong bg-card px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="flat">{t("pfAreaCity.modelFlat")}</option>
                <option value="per_km">{t("pfAreaCity.modelPerKm")}</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5 flex-1">
              <FieldLabel>{r.model === "flat" ? t("pfAreaCity.rateFlat") : t("pfAreaCity.ratePerKm")}</FieldLabel>
              <RupiahInput value={r.rate} onChange={(v) => setRule(i, { rate: v })} />
            </div>
            {r.model === "per_km" && (
              <div className="flex flex-col gap-1.5 flex-1">
                <FieldLabel>{t("pfAreaCity.minimumFee")}</FieldLabel>
                <RupiahInput value={r.minimum_fee} onChange={(v) => setRule(i, { minimum_fee: v })} />
              </div>
            )}
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={addRule}
        className="w-full text-xs text-primary border border-dashed border-primary-border rounded-md px-3 py-1.5 hover:bg-primary-soft/50 inline-flex items-center justify-center gap-1.5"
      >
        <Plus className="w-3.5 h-3.5" /> {t("pfAreaCity.addArea")}
      </button>
    </div>
  );
}
