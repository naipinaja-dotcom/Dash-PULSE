// Shell: info card, tombol save, pemilihan kategori/subtype. Field per
// kategori dipecah ke pricing-form/delivery-fields.tsx (kategori 1),
// pricing-form/attendance-fields.tsx (kategori 2), kalkulator interaktif ke
// pricing-form/interactive-calc.tsx.
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { usePostHog } from "@posthog/react";
import { AdminLayout } from "@/components/admin-layout";
import { ClientCombobox } from "@/components/client-combobox";
import { DatePicker } from "@/components/date-picker";
import {
  PRICING_CATEGORIES,
  DELIVERY_DIMENSIONS,
  type PricingCategory,
  type PricingSubtype,
  type PricingScheme,
  type PricingEnvelope,
  type SchemeFor,
  type DeliveryDimensions,
} from "@/lib/pricing-types";
import {
  getPricingScheme,
  listClients,
  savePricingScheme,
  type MockClient,
} from "@/lib/pricing-store";
import { formatRupiah, parseRupiah } from "@/lib/format";
import { useT } from "@/lib/i18n";
import {
  ArrowLeft,
  Info,
  Truck,
  Ruler,
  Package,
  CalendarDays,
  Save,
  Layers,
  ChevronRight,
  SlidersHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import {
  FieldLabel,
  TextInput,
  RupiahInput,
  ToggleBlock,
  StepTierEditor,
  buildStepTier,
  stepTierToState,
  emptyStepTier,
  sanitizeDecimalInput,
  type StepTierState,
} from "./pricing-form/shared";
import {
  DeliveryFields,
  emptyDeliveryState,
  buildDeliveryConfig,
  deliveryEnvelopeType,
  loadDeliveryState,
  type DeliveryState,
} from "./pricing-form/delivery-fields";
import {
  AttendanceFields,
  emptyAttendanceState,
  buildAttendanceConfig,
  loadAttendanceState,
  type AttendanceState,
} from "./pricing-form/attendance-fields";
import { InteractiveCalc } from "./pricing-form/interactive-calc";
import { RevenueShareCalc } from "./pricing-form/revenue-share-calc";
import { loadDeliveryCompState } from "./pricing-form/attendance-delivery-comp";
import {
  AreaCityFields,
  emptyAreaCityState,
  buildAreaCityConfig,
  loadAreaCityState,
  validateAreaCityState,
  type AreaCityState,
} from "./pricing-form/area-city-fields";

const CATEGORY_ICONS = { Truck, CalendarDays, Layers } as const;
const DIMENSION_ICONS = { distance: Ruler, weight: Package } as const;

// -------------------- Bentuk state form (semua string, di-parse saat simpan) --------------------
interface FormState {
  delivery: DeliveryState;
  attendance: AttendanceState;
  addKgOn: boolean;
  addKg: StepTierState;
  multiDropOn: boolean;
  multiDropFee: string;
  areaCityOn: boolean;
  areaCity: AreaCityState;
  revenueShareOn: boolean;
  revenueSharePercent: string;
  billingOn: boolean;
  billing: {
    min_charge: string;
    admin_fee_flat: string;
    management_fee_percent: string;
    insurance_fee_mode: "flat" | "percent";
    insurance_fee_amount: string;
    ppn_percent: string;
  };
}

function emptyForm(): FormState {
  return {
    delivery: emptyDeliveryState(),
    attendance: emptyAttendanceState(),
    addKgOn: false,
    addKg: emptyStepTier(),
    multiDropOn: false,
    multiDropFee: "3000",
    areaCityOn: false,
    areaCity: emptyAreaCityState(),
    revenueShareOn: false,
    revenueSharePercent: "80",
    billingOn: false,
    billing: { min_charge: "", admin_fee_flat: "", management_fee_percent: "", insurance_fee_mode: "flat", insurance_fee_amount: "", ppn_percent: "11" },
  };
}

function buildEnvelope(
  category: PricingCategory,
  subtype: PricingSubtype,
  schemeFor: SchemeFor,
  f: FormState,
): PricingEnvelope {
  // Revenue Share ganti total cara hitung base fee (persen dari revenue
  // client, bukan dari dimensi Distance/Weight) — cuma masuk akal buat sisi
  // Rider. Dims/Add-KG/Multi-drop diabaikan total kalau mode ini aktif,
  // bukan ditumpuk di atasnya (fee-nya murni % revenue).
  if (category === "delivery" && schemeFor === "rider" && f.revenueShareOn) {
    return {
      version: 1,
      type: "revenue_share",
      config: { percent_to_rider: Number(f.revenueSharePercent) || 0 },
      add_kg: null,
      multi_drop: null,
      billing_addons: null,
      area_city_pricing: null,
    };
  }

  const type: PricingEnvelope["type"] = category === "delivery" ? deliveryEnvelopeType(subtype, f.delivery) : "attendance";
  const config: Record<string, unknown> =
    category === "delivery"
      ? (buildDeliveryConfig(subtype, f.delivery) as unknown as Record<string, unknown>)
      : buildAttendanceConfig(f.attendance);

  return {
    version: 1,
    type,
    config,
    // Add-KG modifier lama nempel di luar config — sekarang Weight (dimensi
    // modular) sudah punya kalkulasi berat sendiri, jadi modifier ini cuma
    // relevan kalau Weight TIDAK dipakai (biar gak double-count berat).
    add_kg:
      category === "delivery" && f.addKgOn && !(subtype as DeliveryDimensions | null)?.weight
        ? { enabled: true, tier: buildStepTier(f.addKg) }
        : null,
    // Sama seperti Add-KG di atas — cuma masuk akal buat kategori delivery
    // (multi_drop dihitung dari delivery_records.delivery_date, gak ada
    // ekuivalennya di attendance/hybrid). calcAttendanceScheme/calcHybridScheme
    // gak pernah baca field ini, jadi kalau gak di-gate di sini toggle-nya
    // nyantol gak kepake (sama kelasnya sama bug billing_addons di atas).
    multi_drop:
      category === "delivery" && f.multiDropOn
        ? { fee_per_extra_shipment: parseRupiah(f.multiDropFee) }
        : null,
    // Area City Pricing — cuma masuk akal buat delivery (bukan revenue_share,
    // sudah di-gate di return awal fungsi ini). null kalau toggle mati, biar
    // resolveAreaPricingRule di pricing-calc.ts fallback ke default (identik
    // perilaku sebelum fitur ini, lihat prioritas #1 di PRD).
    area_city_pricing:
      category === "delivery" && f.areaCityOn ? buildAreaCityConfig(f.areaCity, true) : null,
    billing_addons:
      schemeFor === "client" && f.billingOn
        ? {
            min_charge: parseRupiah(f.billing.min_charge),
            admin_fee_flat: parseRupiah(f.billing.admin_fee_flat),
            management_fee_percent: Number(f.billing.management_fee_percent) || 0,
            insurance_fee_mode: f.billing.insurance_fee_mode,
            insurance_fee_amount:
              f.billing.insurance_fee_mode === "percent"
                ? Number(f.billing.insurance_fee_amount) || 0
                : parseRupiah(f.billing.insurance_fee_amount),
            ppn_percent: Number(f.billing.ppn_percent) || 0,
          }
        : null,
  };
}

function loadForm(scheme: PricingScheme | undefined): {
  form: FormState;
  category: PricingCategory;
  subtype: PricingSubtype;
  schemeFor: SchemeFor;
} {
  const form = emptyForm();
  const rawCategory: PricingCategory = scheme?.category ?? "delivery";
  // "hybrid" gak ada tab/field-nya lagi di form ini (PRICING_CATEGORIES cuma
  // delivery/attendance) — dulu category state dibiarin "hybrid" walau
  // isinya udah dikonversi ke bentuk attendance di bawah, jadi form-nya
  // render KOSONG TOTAL (gak ada kondisi category yang cocok) sementara
  // Save tetap jalan diam-diam pakai data attendance yang gak pernah keliatan
  // admin. Normalize ke "attendance" di sini biar field-nya beneran ke-render
  // & bisa direview sebelum disimpan ulang.
  const category: PricingCategory = rawCategory === "hybrid" ? "attendance" : rawCategory;
  const subtype: PricingSubtype = scheme?.subtype ?? (category === "delivery" ? { distance: true, weight: false } : null);

  if (!scheme || !scheme.params || scheme.params.version !== 1) {
    return { form, category, subtype, schemeFor: scheme?.scheme_for ?? "rider" };
  }

  const env = scheme.params;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = env.config as any;

  if (env.type === "revenue_share") {
    form.revenueShareOn = true;
    form.revenueSharePercent = String(c.percent_to_rider ?? "");
  } else if (category === "delivery") {
    form.delivery = loadDeliveryState(subtype, env.type, c);
  } else if (rawCategory === "attendance") {
    form.attendance = loadAttendanceState(c);
  } else if (rawCategory === "hybrid") {
    // Legacy hybrid → attendance + deliveryComp enabled (ontime_bonus jadi incentive)
    form.attendance = {
      full_fee: String(c.full_fee ?? ""),
      standard_hours: String((Number(c.standard_minutes) || 0) / 60 || ""),
      overtimeOn: false,
      overtime_rate_per_hour: "0",
      incentives: c.ontime_bonus ? [{ label: "Bonus Ontime", amount: String(c.ontime_bonus), condition: "ontime_only" as const }] : [],
      shiftsOn: false,
      shifts: [],
      deliveryCompOn: true,
      deliveryComp: loadDeliveryCompState({
        method: "tier",
        order_by: c.order_by ?? "distance",
        order_tier: c.order_tier ?? null,
      }),
    };
  }

  // modifiers
  if (env.add_kg) {
    form.addKgOn = true;
    form.addKg = stepTierToState(env.add_kg.tier);
  }
  if (env.multi_drop) {
    form.multiDropOn = true;
    form.multiDropFee = String(env.multi_drop.fee_per_extra_shipment ?? "");
  }
  if (env.area_city_pricing?.enabled) {
    form.areaCityOn = true;
    form.areaCity = loadAreaCityState(env.area_city_pricing);
  }
  if (env.billing_addons) {
    form.billingOn = true;
    form.billing = {
      min_charge: String(env.billing_addons.min_charge ?? ""),
      admin_fee_flat: String(env.billing_addons.admin_fee_flat ?? ""),
      management_fee_percent: String(env.billing_addons.management_fee_percent ?? ""),
      insurance_fee_mode: env.billing_addons.insurance_fee_mode === "percent" ? "percent" : "flat",
      insurance_fee_amount: String(env.billing_addons.insurance_fee_amount ?? ""),
      ppn_percent: String(env.billing_addons.ppn_percent ?? ""),
    };
  }

  return { form, category, subtype, schemeFor: scheme.scheme_for ?? "rider" };
}

// -------------------- Main form --------------------
// Wrapper: ambil scheme yang mau di-edit dulu (async, dari Supabase) SEBELUM
// form-nya di-mount. Ini penting karena field di bawah pakai useState(initial)
// yang cuma jalan sekali pas mount — kalau datanya nyusul belakangan, field
// bakal tetep kosong. Jadi tunggu dulu, baru render form-nya.
export function PricingForm({ mode, schemeId }: { mode: "create" | "edit"; schemeId?: string }) {
  const { t } = useT();
  const [existing, setExisting] = useState<PricingScheme | null>(null);
  const [ready, setReady] = useState(mode === "create");

  useEffect(() => {
    if (mode === "edit" && schemeId) {
      getPricingScheme(schemeId).then((s) => {
        setExisting(s ?? null);
        setReady(true);
      });
    }
  }, [mode, schemeId]);

  if (!ready) {
    return (
      <AdminLayout title={t("pform.editSchemeTitle")}>
        <div className="p-10 text-center text-muted-foreground text-sm">{t("pform.loadingScheme")}</div>
      </AdminLayout>
    );
  }

  return (
    <PricingFormInner key={existing?.id ?? "new"} mode={mode} existing={existing ?? undefined} />
  );
}

function PricingFormInner({
  mode,
  existing,
}: {
  mode: "create" | "edit";
  existing?: PricingScheme;
}) {
  const { t } = useT();
  const navigate = useNavigate();
  const posthog = usePostHog();
  const [clients, setClients] = useState<MockClient[]>([]);

  const loaded = useMemo(() => loadForm(existing), [existing]);

  const [name, setName] = useState(existing?.name ?? "");
  const [clientId, setClientId] = useState(existing?.client_id ?? "");
  const [schemeFor, setSchemeFor] = useState<SchemeFor>(loaded.schemeFor);
  const [effFrom, setEffFrom] = useState(
    existing?.effective_from ?? new Date().toISOString().slice(0, 10),
  );
  const [effTo, setEffTo] = useState(existing?.effective_to ?? "");
  const [category, setCategory] = useState<PricingCategory>(loaded.category);
  const [subtype, setSubtype] = useState<PricingSubtype>(loaded.subtype);
  const [f, setF] = useState<FormState>(loaded.form);
  // Modifier Tambahan (Add-KG/Multi-drop/Area City Pricing) — collapsed by
  // default, tapi auto-terbuka kalau skema yang lagi dibuka udah pakai salah
  // satu (biar gak nyembunyiin setting yang sedang aktif). Dihitung sekali dari
  // data awal (bukan reaktif ke f.*) — sekali user buka manual atau nutup lagi,
  // itu keputusan mereka, gak dipaksa balik oleh perubahan checkbox internal.
  const [modifiersOpen, setModifiersOpen] = useState(
    loaded.form.addKgOn || loaded.form.multiDropOn || loaded.form.areaCityOn,
  );

  useEffect(() => {
    listClients().then(setClients);
  }, []);

  const patch = (p: Partial<FormState>) => setF((prev) => ({ ...prev, ...p }));

  const handleCategoryChange = (cat: PricingCategory) => {
    setCategory(cat);
    if (cat === "attendance") setSubtype(null);
    else if (cat === "delivery")
      setSubtype((prev) => (prev as DeliveryDimensions | null) ?? { distance: true, weight: false });
  };

  const [saving, setSaving] = useState(false);
  const handleSave = async () => {
    if (!effFrom) return toast.error(t("pform.effFromRequired"));
    if (category === "delivery" && f.areaCityOn) {
      const err = validateAreaCityState(f.areaCity);
      if (err) return toast.error(err);
    }
    // Nama opsional — kalau dikosongin, dibikinin otomatis dari client + sisi + tipe.
    const activeCategory = PRICING_CATEGORIES.find((c) => c.key === category)!;
    const autoName = [
      clients.find((c) => c.id === clientId)?.name ?? t("pform.allClients"),
      schemeFor === "client" ? t("pform.client") : t("pform.rider"),
      activeCategory.name,
    ].join(" · ");
    const finalName = name.trim() || autoName;
    setSaving(true);
    try {
      await savePricingScheme({
        id: existing?.id,
        name: finalName,
        client_id: clientId || null,
        scheme_for: schemeFor,
        effective_from: effFrom,
        effective_to: effTo || null,
        params: buildEnvelope(category, subtype, schemeFor, f),
      });
      posthog.capture("pricing_scheme_saved", {
        mode,
        category,
        subtype: subtype ?? null,
        scheme_for: schemeFor,
      });
      toast.success(mode === "create" ? t("pform.schemeCreated") : t("pform.schemeUpdated"));
      navigate({ to: "/admin/pricing" });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminLayout
      title={mode === "create" ? t("pform.addSchemeTitle") : t("pform.editSchemeTitle")}
      subtitle={t("pform.pageSubtitle")}
    >
      <div className="pricing-workbench">
      <button
        type="button"
        onClick={() => navigate({ to: "/admin/pricing" })}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> {t("pform.backToList")}
      </button>

      {/* Rail (kiri, sticky) + Builder (kanan) — digabung dari 3 card terpisah
          (Info / Kategori / Modifier) biar Billing Add-ons (dulu nyempil di
          card Modifier paling bawah, di dalam ToggleBlock default-collapsed)
          keliatan begitu buka halaman, dan tabel rate + kalkulator gak perlu
          discroll jauh buat sampe. Gak ada field/handler yang dihapus — cuma
          dipindah posisi. */}
      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4 mb-4 items-start">
        <aside className="pricing-rail rounded-xl border-[3px] border-border-strong bg-card p-5 shadow-[6px_6px_0_0_var(--color-border-strong)] space-y-4 lg:sticky lg:top-4">
          <div className="flex flex-col gap-1.5">
            <FieldLabel>
              {t("pform.schemeName")} <span className="font-normal text-muted-foreground">({t("pform.optional")})</span>
            </FieldLabel>
            <TextInput
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("pform.schemeNamePlaceholder")}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel>{t("pform.client")}</FieldLabel>
            <ClientCombobox
              value={clientId}
              onChange={setClientId}
              placeholder={t("pform.allClients")}
              className="w-full text-sm py-1.5"
              options={clients.map((c) => ({ value: c.id, label: c.name }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <FieldLabel>{t("pform.effectiveFrom")}</FieldLabel>
              <DatePicker value={effFrom} onChange={setEffFrom} className="w-full" />
            </div>
            <div className="flex flex-col gap-1.5">
              <FieldLabel>
                {t("pform.effectiveTo")} <span className="font-normal">({t("pform.optional")})</span>
              </FieldLabel>
              <DatePicker value={effTo} onChange={setEffTo} className="w-full" />
            </div>
          </div>

          {/* Scheme for */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1.5">{t("pform.schemeForLabel")}</p>
            <div className="grid grid-cols-1 gap-2">
              {(["rider", "client"] as SchemeFor[]).map((sf) => (
                <button
                  key={sf}
                  data-pricing-side={sf}
                  type="button"
                  onClick={() => setSchemeFor(sf)}
                  className={
                    "text-left rounded-md px-3 py-2.5 border-2 border-border-strong transition-colors " +
                    (schemeFor === sf
                      ? "bg-primary text-primary-foreground shadow-[3px_3px_0_0_var(--color-border-strong)]"
                      : "bg-card text-foreground hover:bg-muted")
                  }
                >
                  <span className="text-xs font-medium block">
                    {sf === "rider" ? t("pform.riderCost") : t("pform.clientRevenue")}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {sf === "rider" ? t("pform.riderCostDesc") : t("pform.clientRevenueDesc")}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-2">
              {t("pform.selectCategory")}
            </p>
            <div className="grid grid-cols-1 gap-2">
              {PRICING_CATEGORIES.map((cat) => {
                const Icon = CATEGORY_ICONS[cat.icon as keyof typeof CATEGORY_ICONS] ?? Truck;
                const active = category === cat.key;
                return (
                  <button
                    key={cat.key}
                    data-pricing-category={cat.key}
                    type="button"
                    onClick={() => handleCategoryChange(cat.key)}
                    className={
                      "text-left rounded-md px-3 py-2.5 flex flex-col gap-1 transition-all duration-150 border-2 border-border-strong " +
                      (active
                        ? "bg-primary text-primary-foreground shadow-[3px_3px_0_0_var(--color-border-strong)]"
                        : "bg-card text-foreground hover:bg-muted")
                    }
                  >
                    <div className="flex items-center gap-1.5">
                      <Icon className="w-4 h-4" />
                      <span className="text-xs font-medium leading-tight">{cat.name}</span>
                    </div>
                    <span className="text-[11px] text-muted-foreground leading-snug">{cat.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Revenue Share — fee rider = % dari revenue client per AWB (bukan
              dari dimensi Distance/Weight). Cuma masuk akal buat sisi Rider:
              revenue-nya sendiri diambil dari skema Client yang aktif pas
              Hitung Fee (lihat admin.calculate.tsx), bukan diisi di sini. */}
          {category === "delivery" && schemeFor === "rider" && (
            <ToggleBlock
              label={t("pform.revenueShareLabel")}
              hint={t("pform.revenueShareHint")}
              on={f.revenueShareOn}
              onToggle={(on) => patch({ revenueShareOn: on })}
            >
              <div className="flex flex-col gap-1.5 max-w-xs">
                <FieldLabel>{t("pform.percentToRider")}</FieldLabel>
                <TextInput
                  value={f.revenueSharePercent}
                  inputMode="decimal"
                  onChange={(e) => patch({ revenueSharePercent: sanitizeDecimalInput(e.target.value) })}
                />
              </div>
            </ToggleBlock>
          )}

          {/* Dimensi delivery — checkbox Distance / Weight */}
          {category === "delivery" && !f.revenueShareOn && (
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-2">
                {t("pform.pricingDimensionsLabel")}
              </label>
              <div className="grid grid-cols-1 gap-2">
                {DELIVERY_DIMENSIONS.map((dim) => {
                  const Icon = DIMENSION_ICONS[dim.key];
                  const dims = (subtype as DeliveryDimensions) || { distance: false, weight: false };
                  const checked = dims[dim.key] ?? false;

                  return (
                    <label
                      key={dim.key}
                      data-pricing-dimension={dim.key}
                      className={
                        "text-left rounded-md px-3 py-2.5 flex items-start gap-2.5 transition-all duration-150 border-2 border-border-strong cursor-pointer " +
                        (checked
                          ? "bg-primary text-primary-foreground shadow-[3px_3px_0_0_var(--color-border-strong)]"
                          : "bg-card text-foreground hover:bg-muted")
                      }
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => setSubtype({ ...dims, [dim.key]: e.target.checked })}
                        className="w-4 h-4 mt-0.5 flex-shrink-0"
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-1.5">
                          <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                          <span className="text-xs font-medium leading-tight">{dim.name}</span>
                        </div>
                        <span className="text-[11px] text-muted-foreground leading-snug block mt-0.5">{dim.desc}</span>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* Callout */}
          <div className="pricing-callout rounded-md border-2 border-border-strong bg-secondary px-3.5 py-2.5 flex items-start gap-2.5">
            <Info className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
            <p className="text-xs text-foreground leading-relaxed">
              {category === "delivery"
                ? (() => {
                    if (f.revenueShareOn) return t("pform.calloutRevenueShare");
                    const dims = subtype as DeliveryDimensions | null;
                    if (!dims || (!dims.distance && !dims.weight)) return PRICING_CATEGORIES.find((c) => c.key === category)!.callout;
                    const enabled = DELIVERY_DIMENSIONS.filter((d) => dims[d.key]).map((d) => d.name);
                    if (enabled.length === 1) return DELIVERY_DIMENSIONS.find((d) => d.name === enabled[0])!.callout;
                    return t("pform.calloutBothDimensions");
                  })()
                : PRICING_CATEGORIES.find((c) => c.key === category)!.callout}
            </p>
          </div>

          {/* Billing Add-ons — dipindah dari card Modifier paling bawah biar
              gak nyembunyi di collapsed toggle yang jauh di bawah fold (lihat
              diskusi redesign). Gating sama persis kayak sebelumnya:
              scheme_for === "client" doang, gak dibatasi kategori. */}
          {schemeFor === "client" && (
            <ToggleBlock
              label={t("pform.billingAddonsLabel")}
              hint={t("pform.billingAddonsHint")}
              on={f.billingOn}
              onToggle={(on) => patch({ billingOn: on })}
            >
              <div className="grid grid-cols-1 gap-3">
                <div className="flex flex-col gap-1.5">
                  <FieldLabel>{t("pform.minCharge")}</FieldLabel>
                  <RupiahInput
                    value={f.billing.min_charge}
                    onChange={(v) => patch({ billing: { ...f.billing, min_charge: v } })}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <FieldLabel>{t("pform.managementFee")}</FieldLabel>
                  <TextInput
                    value={f.billing.management_fee_percent}
                    inputMode="decimal"
                    onChange={(e) =>
                      patch({ billing: { ...f.billing, management_fee_percent: sanitizeDecimalInput(e.target.value) } })
                    }
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <FieldLabel>{t("pform.adminFee")}</FieldLabel>
                  <RupiahInput
                    value={f.billing.admin_fee_flat}
                    onChange={(v) => patch({ billing: { ...f.billing, admin_fee_flat: v } })}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <FieldLabel>{t("pform.insuranceFee")}</FieldLabel>
                  <div className="flex gap-1.5">
                    <select
                      value={f.billing.insurance_fee_mode}
                      onChange={(e) =>
                        patch({
                          billing: {
                            ...f.billing,
                            insurance_fee_mode: e.target.value as "flat" | "percent",
                            insurance_fee_amount: "",
                          },
                        })
                      }
                      className="w-24 flex-shrink-0 rounded-md border-2 border-border-strong bg-background px-2 text-sm outline-none focus:ring-1 focus:ring-ring"
                    >
                      <option value="flat">{t("pform.insuranceModeFlat")}</option>
                      <option value="percent">{t("pform.insuranceModePercent")}</option>
                    </select>
                    {f.billing.insurance_fee_mode === "percent" ? (
                      <TextInput
                        value={f.billing.insurance_fee_amount}
                        inputMode="decimal"
                        onChange={(e) =>
                          patch({ billing: { ...f.billing, insurance_fee_amount: sanitizeDecimalInput(e.target.value) } })
                        }
                      />
                    ) : (
                      <RupiahInput
                        value={f.billing.insurance_fee_amount}
                        onChange={(v) => patch({ billing: { ...f.billing, insurance_fee_amount: v } })}
                      />
                    )}
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <FieldLabel>{t("pform.ppn")}</FieldLabel>
                  <TextInput
                    value={f.billing.ppn_percent}
                    inputMode="decimal"
                    onChange={(e) =>
                      patch({ billing: { ...f.billing, ppn_percent: sanitizeDecimalInput(e.target.value) } })
                    }
                  />
                </div>
              </div>
            </ToggleBlock>
          )}
        </aside>

        {/* Builder — tabel rate/attendance, modifier delivery-only (Add-KG,
            Multi-drop), kalkulator hidup, semuanya dalam 1 panel biar keliatan
            bareng tanpa scroll jauh. */}
        <div className="pricing-builder rounded-xl border-[3px] border-border-strong bg-card p-5 shadow-[6px_6px_0_0_var(--color-border-strong)] space-y-4">
          {category === "delivery" && f.revenueShareOn && (
            <RevenueShareCalc
              clientId={clientId}
              effFrom={effFrom}
              effTo={effTo}
              percentToRider={f.revenueSharePercent}
            />
          )}

          {category === "delivery" && !f.revenueShareOn && subtype && (
            <DeliveryFields
              subtype={subtype}
              value={f.delivery}
              onChange={(v) => patch({ delivery: v })}
            />
          )}

          {category === "attendance" && (
            <AttendanceFields value={f.attendance} onChange={(v) => patch({ attendance: v })} />
          )}

          {category === "delivery" && !f.revenueShareOn && (() => {
            const activeCount = [f.addKgOn, f.multiDropOn, f.areaCityOn].filter(Boolean).length;
            const hasActive = activeCount > 0;
            return (
              <div
                className={
                  "rounded-md transition-colors " +
                  (hasActive ? "border-2 border-primary bg-primary-soft" : "border-2 border-primary-soft bg-primary-soft/40")
                }
              >
                <button
                  type="button"
                  onClick={() => setModifiersOpen((o) => !o)}
                  className={
                    "w-full flex items-center justify-between gap-2 px-3.5 py-2.5 text-left hover:bg-primary-soft/70 rounded-md transition-colors " +
                    (hasActive ? "text-primary-soft-foreground" : "text-foreground")
                  }
                >
                  <span className="flex items-center gap-2.5">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground flex-shrink-0">
                      <SlidersHorizontal className="w-3.5 h-3.5" />
                    </span>
                    <ChevronRight
                      className={"w-4 h-4 flex-shrink-0 transition-transform text-muted-foreground " + (modifiersOpen ? "rotate-90" : "")}
                    />
                    <span className="flex flex-col">
                      <span className="text-sm font-semibold leading-tight">{t("pform.modifiersToggle")}</span>
                      <span className="text-[11px] font-normal text-muted-foreground">{t("pform.modifiersSubtitle")}</span>
                    </span>
                  </span>
                  {hasActive && (
                    <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground flex-shrink-0">
                      {activeCount} {t("pform.modifiersActiveSuffix")}
                    </span>
                  )}
                </button>
                {modifiersOpen && (
                  <div className="px-3.5 pb-3.5 space-y-3">
                    {!(subtype as DeliveryDimensions | null)?.weight && (
                      <ToggleBlock
                        label={t("pform.addKgLabel")}
                        hint={t("pform.addKgHint")}
                        on={f.addKgOn}
                        onToggle={(on) => patch({ addKgOn: on })}
                      >
                        <StepTierEditor unit="kg" value={f.addKg} onChange={(v) => patch({ addKg: v })} />
                      </ToggleBlock>
                    )}

                    <ToggleBlock
                      label={t("pform.multiDropLabel")}
                      hint={t("pform.multiDropHint")}
                      on={f.multiDropOn}
                      onToggle={(on) => patch({ multiDropOn: on })}
                    >
                      <div className="flex flex-col gap-1.5 max-w-xs">
                        <FieldLabel>{t("pform.feePerExtraShipment")}</FieldLabel>
                        <RupiahInput value={f.multiDropFee} onChange={(v) => patch({ multiDropFee: v })} />
                      </div>
                    </ToggleBlock>

                    <ToggleBlock
                      label={t("pform.areaCityPricingLabel")}
                      hint={t("pform.areaCityPricingHint")}
                      on={f.areaCityOn}
                      onToggle={(on) => patch({ areaCityOn: on })}
                    >
                      <AreaCityFields value={f.areaCity} onChange={(v) => patch({ areaCity: v })} />
                    </ToggleBlock>
                  </div>
                )}
              </div>
            );
          })()}

          {!(category === "delivery" && f.revenueShareOn) && (
            <InteractiveCalc
              category={category}
              subtype={subtype}
              delivery={f.delivery}
              attendance={f.attendance}
              schemeFor={schemeFor}
              addKgOn={f.addKgOn}
              multiDropOn={f.multiDropOn}
              multiDropFee={f.multiDropFee}
              areaCityOn={f.areaCityOn}
              areaCity={f.areaCity}
              billingOn={f.billingOn}
            />
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => navigate({ to: "/admin/pricing" })}
          className="rounded-md border border-border bg-card px-4 py-2 text-sm hover:bg-muted"
        >
          {t("pform.cancel")}
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          {saving ? t("pform.saving") : t("pform.saveScheme")}
        </button>
      </div>
      </div>
    </AdminLayout>
  );
}
