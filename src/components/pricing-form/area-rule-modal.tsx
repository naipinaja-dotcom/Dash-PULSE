// Modal "Tambah/Edit kota beda tarif" — dipisah dari pricing-form.tsx biar
// rail kiri gak penuh form panjang per baris.
//
// SATU jalur aja buat kota BARU: isi City → pilih jenis skema → "Buat Skema"
// loncat ke form scheme penuh (/admin/pricing/new), sama persis kayak bikin
// skema baru biasa — jadi km/weight/surcharge/threshold/Return/pembeda
// District semua otomatis kepake (itu semua fitur builder modular_v2, bukan
// hal baru yang perlu dibikinin ulang di sini). Gak ada lagi jalur "cuma
// tarif" terpisah biar gak ada 2 mekanisme beda yang bikin bingung mana yang
// ke-save di sini vs yang loncat halaman (lihat riwayat AREA_KIND_OPTIONS di
// pricing-form.tsx).
//
// Step "rate" (Flat/Per KM langsung disave ke area_city_pricing.rules) CUMA
// nongol pas EDIT rule lama yang udah kepalanjur disimpen lewat mekanisme
// lama — dipertahankan biar data lama masih bisa diedit/dihapus, tapi gak
// bisa dibikin baru lagi dari modal ini.
import { useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { toast } from "sonner";
import { useT } from "@/lib/i18n";
import { FieldLabel, TextInput, RupiahInput } from "./shared";
import { citiesFromRaw, validateAreaCityState, type AreaRuleState } from "./area-city-fields";

const SCHEME_KIND_OPTIONS = [
  {
    key: "delivery_other",
    labelKey: "pform.areaModelDelivery",
    category: "delivery" as const,
    revenueShare: false,
  },
  {
    key: "revenue_share",
    labelKey: "pform.areaModelRevenueShare",
    category: "delivery" as const,
    revenueShare: true,
  },
  {
    key: "attendance",
    labelKey: "pform.areaModelAttendance",
    category: "attendance" as const,
    revenueShare: false,
  },
] as const;

function newRuleId(): string {
  return `area_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function AreaRuleModal({
  editing,
  existingRules,
  clientId,
  onClose,
  onSave,
}: {
  editing: AreaRuleState | null;
  existingRules: AreaRuleState[]; // rule lain (BUKAN yang lagi diedit) — buat cek city bentrok
  clientId: string;
  onClose: () => void;
  onSave: (rule: AreaRuleState) => void;
}) {
  const { t } = useT();
  // Edit rule lama (flat/per_km) → step tarif langsung. Kota baru → selalu
  // ke step skema (lihat comment atas file, gak ada jalur "cuma tarif" lagi
  // buat yang baru).
  const [step] = useState<"rate" | "scheme">(editing ? "rate" : "scheme");
  const [citiesRaw, setCitiesRaw] = useState(editing?.citiesRaw ?? "");
  const [name, setName] = useState(editing?.name ?? "");
  const [model, setModel] = useState<"flat" | "per_km">(editing?.model ?? "flat");
  const [rate, setRate] = useState(editing?.rate ?? "");
  const [minimumFee, setMinimumFee] = useState(editing?.minimum_fee ?? "");
  const [schemeKind, setSchemeKind] =
    useState<(typeof SCHEME_KIND_OPTIONS)[number]["key"]>("delivery_other");

  const cities = citiesFromRaw(citiesRaw);
  const schemeOpt = SCHEME_KIND_OPTIONS.find((o) => o.key === schemeKind)!;

  const submitRate = () => {
    const candidate: AreaRuleState = {
      id: editing?.id ?? newRuleId(),
      name: name.trim(),
      citiesRaw,
      model,
      rate,
      minimum_fee: minimumFee,
    };
    const err = validateAreaCityState({ rules: [...existingRules, candidate] });
    if (err) return toast.error(err);
    onSave(candidate);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-md max-h-[85vh] overflow-y-auto rounded-xl border-2 border-border-strong bg-card p-5 shadow-[8px_8px_0_0_var(--color-border-strong)] flex flex-col gap-3.5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold">
          {editing ? t("pfAreaCity.editHeading") : t("pfAreaCity.addHeading")}
        </h3>

        <div className="flex flex-col gap-1">
          <FieldLabel>{t("pfAreaCity.cities")}</FieldLabel>
          <span className="text-[11px] text-muted-foreground leading-snug">
            {t("pfAreaCity.citiesHint")}
          </span>
          <TextInput
            value={citiesRaw}
            placeholder={t("pfAreaCity.citiesPlaceholder")}
            onChange={(e) => setCitiesRaw(e.target.value)}
            className="mt-0.5"
            autoFocus
          />
        </div>

        {step === "rate" && (
          <div className="flex flex-col gap-2.5">
            <div className="flex flex-col gap-1">
              <FieldLabel>{t("pfAreaCity.areaName")}</FieldLabel>
              <TextInput
                value={name}
                placeholder={t("pfAreaCity.areaNamePlaceholder")}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <div className="flex flex-col gap-1.5">
                <FieldLabel>{t("pfAreaCity.model")}</FieldLabel>
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value as "flat" | "per_km")}
                  className="rounded-md border-2 border-border-strong bg-card px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="flat">{t("pfAreaCity.modelFlat")}</option>
                  <option value="per_km">{t("pfAreaCity.modelPerKm")}</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5 flex-1">
                <FieldLabel>
                  {model === "flat" ? t("pfAreaCity.rateFlat") : t("pfAreaCity.ratePerKm")}
                </FieldLabel>
                <RupiahInput value={rate} onChange={setRate} />
              </div>
              {model === "per_km" && (
                <div className="flex flex-col gap-1.5 flex-1">
                  <FieldLabel>{t("pfAreaCity.minimumFee")}</FieldLabel>
                  <RupiahInput value={minimumFee} onChange={setMinimumFee} />
                </div>
              )}
            </div>
          </div>
        )}

        {step === "scheme" && (
          <div className="flex flex-col gap-2.5">
            <div className="flex flex-col gap-1.5">
              <FieldLabel>{t("pfAreaCity.schemeKindLabel")}</FieldLabel>
              <select
                value={schemeKind}
                onChange={(e) => setSchemeKind(e.target.value as typeof schemeKind)}
                className="rounded-md border-2 border-border-strong bg-card px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
              >
                {SCHEME_KIND_OPTIONS.map((o) => (
                  <option key={o.key} value={o.key}>
                    {t(o.labelKey)}
                  </option>
                ))}
              </select>
              {schemeKind === "delivery_other" && (
                <p className="text-[11px] text-muted-foreground">
                  {t("pfAreaCity.schemeKindDeliveryHint")}
                </p>
              )}
              {schemeKind === "attendance" && (
                <p className="text-[11px] text-amber-700 dark:text-amber-400">
                  {t("pform.areaModelAttendanceWarning")}
                </p>
              )}
            </div>
            <Link
              to="/admin/pricing/new"
              search={{
                clientId: clientId || undefined,
                cityScope: cities.length ? cities.join(", ") : undefined,
                category: schemeOpt.category,
                revenueShare: schemeOpt.revenueShare || undefined,
              }}
              disabled={cities.length === 0}
              onClick={onClose}
              className={
                "inline-flex items-center justify-center gap-1 rounded-md border-2 border-border-strong px-2.5 py-2 text-sm font-medium " +
                (cities.length === 0
                  ? "pointer-events-none opacity-50 bg-muted"
                  : "bg-primary text-primary-foreground hover:opacity-90")
              }
            >
              {t("pform.createSchemeForArea")} <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border-2 border-border-strong bg-card px-3.5 py-1.5 text-sm font-medium hover:bg-muted"
          >
            {t("pform.cancel")}
          </button>
          {step === "rate" && (
            <button
              type="button"
              onClick={submitRate}
              className="rounded-lg border-2 border-border-strong bg-primary text-primary-foreground px-3.5 py-1.5 text-sm font-bold shadow-[3px_3px_0_0_var(--color-border-strong)] hover:brightness-105"
            >
              {t("pform.saveScheme")}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
