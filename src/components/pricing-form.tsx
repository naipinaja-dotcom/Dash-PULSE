// Shell: info card, tombol save, pemilihan kategori/subtype. Field per
// kategori dipecah ke pricing-form/delivery-fields.tsx (kategori 1),
// pricing-form/attendance-fields.tsx (kategori 2), kalkulator interaktif ke
// pricing-form/interactive-calc.tsx.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { usePostHog } from "@posthog/react";
import { supabase } from "@/integrations/supabase/client";
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
  ChevronDown,
  ChevronRight,
  SlidersHorizontal,
  ArrowUpRight,
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
import { citiesFromRaw } from "./pricing-form/area-city-fields";
import {
  DeliveryIncentiveFields,
  emptyDeliveryIncentiveState,
  buildDeliveryIncentives,
  loadDeliveryIncentiveState,
  validateDeliveryIncentiveState,
  type DeliveryIncentiveRowState,
} from "./pricing-form/delivery-incentive-fields";

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
  // Insentif per rider per hari (uang bensin/makan dsb) — lihat
  // delivery-incentive-fields.tsx & DeliveryIncentive di pricing-types.ts.
  deliveryIncentiveOn: boolean;
  deliveryIncentives: DeliveryIncentiveRowState[];
  // Scope SCHEME INI ke City tertentu — lihat city_scope di pricing-types.ts.
  // Kosong = default. Rate-override per city hidup di `areaCityRules` (state
  // terpisah, lihat PricingFormInner) via AreaRuleModal — bukan di FormState.
  cityScopeRaw: string;
  // Scope SCHEME INI ke Hub tertentu (sender_name) — paralel sama
  // cityScopeRaw di atas, lihat hub_scope di pricing-types.ts.
  hubScopeRaw: string;
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
    deliveryIncentiveOn: false,
    deliveryIncentives: emptyDeliveryIncentiveState(),
    cityScopeRaw: "",
    hubScopeRaw: "",
    revenueShareOn: false,
    revenueSharePercent: "80",
    billingOn: false,
    billing: {
      min_charge: "",
      admin_fee_flat: "",
      management_fee_percent: "",
      insurance_fee_mode: "flat",
      insurance_fee_amount: "",
      ppn_percent: "11",
    },
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
  const cityScope = category === "delivery" ? citiesFromRaw(f.cityScopeRaw) : [];
  // Reuse citiesFromRaw apa adanya — parser CSV generik (trim+split koma),
  // gak spesifik ke city walau namanya begitu.
  const hubScope = category === "delivery" ? citiesFromRaw(f.hubScopeRaw) : [];

  if (category === "delivery" && schemeFor === "rider" && f.revenueShareOn) {
    return {
      version: 1,
      type: "revenue_share",
      config: { percent_to_rider: Number(f.revenueSharePercent) || 0 },
      add_kg: null,
      multi_drop: null,
      billing_addons: null,
      area_city_pricing: null,
      city_scope: cityScope.length ? cityScope : null,
      hub_scope: hubScope.length ? hubScope : null,
    };
  }

  const type: PricingEnvelope["type"] =
    category === "delivery" ? deliveryEnvelopeType(subtype, f.delivery) : "attendance";
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
    // Insentif per rider per hari (uang bensin/makan dsb) — sama gating-nya
    // kayak Add-KG/Multi-drop di atas (delivery-only, cair otomatis tiap
    // rider-hari yang ada kiriman COMPLETED, lihat calcScheme).
    delivery_incentives:
      category === "delivery"
        ? buildDeliveryIncentives(f.deliveryIncentives, f.deliveryIncentiveOn)
        : null,
    // Area City Pricing (rate override per city, terpisah dari scope skema
    // di bawah) — fitur ini udah dipensiunkan, digantiin auto-breakdown
    // District di rate_by="column" (delivery-fields.tsx) yang lebih reliable
    // & gak bikin admin bingung dulu isi tarif di sini atau di rate table.
    area_city_pricing: null,
    // Beda dari area_city_pricing di atas (override RATE) — ini scope SCHEME
    // ini sendiri ke City tertentu, biar 1 client bisa punya beberapa scheme
    // delivery aktif sekaligus (lihat resolveSchemeForCity di pricing-calc.ts).
    city_scope: cityScope.length ? cityScope : null,
    hub_scope: hubScope.length ? hubScope : null,
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
  const subtype: PricingSubtype =
    scheme?.subtype ?? (category === "delivery" ? { distance: true, weight: false } : null);

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
      incentives: c.ontime_bonus
        ? [
            {
              label: "Bonus Ontime",
              amount: String(c.ontime_bonus),
              condition: "ontime_only" as const,
            },
          ]
        : [],
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
  if (env.delivery_incentives?.length) {
    form.deliveryIncentiveOn = true;
    form.deliveryIncentives = loadDeliveryIncentiveState(env.delivery_incentives);
  }
  if (env.city_scope?.length) {
    form.cityScopeRaw = env.city_scope.join(", ");
  }
  if (env.hub_scope?.length) {
    form.hubScopeRaw = env.hub_scope.join(", ");
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
// Pre-fill opsional buat mode="create" — diisi dari search params
// `/admin/pricing/new` (lihat launcher "Area" di bawah & route file-nya).
// Diabaikan total di mode="edit" (scheme yang udah ada selalu menang).
export interface PricingFormInitial {
  clientId?: string;
  cityScope?: string;
  category?: PricingCategory;
  revenueShare?: boolean;
  schemeFor?: SchemeFor;
}

export function PricingForm({
  mode,
  schemeId,
  initial,
}: {
  mode: "create" | "edit";
  schemeId?: string;
  initial?: PricingFormInitial;
}) {
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
        <div className="p-10 text-center text-muted-foreground text-sm">
          {t("pform.loadingScheme")}
        </div>
      </AdminLayout>
    );
  }

  return (
    <PricingFormInner
      key={existing?.id ?? "new"}
      mode={mode}
      existing={existing ?? undefined}
      initial={existing ? undefined : initial}
    />
  );
}

function ScopeDropdown({
  label,
  options,
  selected,
  onToggle,
  emptyText,
}: {
  label: string;
  options: string[];
  selected: Set<string>;
  onToggle: (item: string) => void;
  emptyText: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const tags = [...selected].sort();

  return (
    <div ref={ref} className="relative flex-1 min-w-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={
          "w-full flex items-center gap-1.5 flex-wrap min-h-[36px] px-2.5 py-1 rounded-md border-2 bg-background text-left transition-colors " +
          (open ? "border-primary" : "border-border-strong hover:border-muted-foreground/40")
        }
      >
        {tags.length ? (
          <>
            {tags.map((t) => (
              <span
                key={t}
                className="inline-flex items-center gap-1 rounded-full bg-primary text-primary-foreground px-2 py-0.5 text-[10px] font-medium max-w-[120px] truncate"
              >
                <span className="truncate">{t}</span>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggle(t);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.stopPropagation();
                      onToggle(t);
                    }
                  }}
                  className="opacity-70 hover:opacity-100 cursor-pointer flex-shrink-0"
                >
                  ×
                </span>
              </span>
            ))}
            <span className="rounded-full bg-primary-soft text-primary px-1.5 py-0.5 text-[10px] font-semibold flex-shrink-0">
              {tags.length}
            </span>
          </>
        ) : (
          <span className="text-xs text-muted-foreground">{label}</span>
        )}
        <ChevronDown
          className={
            "w-3.5 h-3.5 ml-auto flex-shrink-0 text-muted-foreground transition-transform " +
            (open ? "rotate-180" : "")
          }
        />
      </button>
      {open && (
        <div className="absolute top-full left-0 right-0 z-20 mt-1 rounded-md border-2 border-border-strong bg-card shadow-md max-h-44 overflow-y-auto">
          {options.length ? (
            options.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => onToggle(opt)}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs hover:bg-muted transition-colors"
              >
                <span
                  className={
                    "w-4 h-4 rounded flex-shrink-0 border-2 flex items-center justify-center transition-colors " +
                    (selected.has(opt)
                      ? "bg-primary border-primary text-primary-foreground"
                      : "border-border-strong")
                  }
                >
                  {selected.has(opt) && (
                    <svg className="w-2.5 h-2.5" viewBox="0 0 10 8" fill="none">
                      <path
                        d="M1 4l2.5 2.5L9 1"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </span>
                {opt}
              </button>
            ))
          ) : (
            <p className="px-3 py-2 text-xs text-muted-foreground">{emptyText}</p>
          )}
        </div>
      )}
    </div>
  );
}

function PricingFormInner({
  mode,
  existing,
  initial,
}: {
  mode: "create" | "edit";
  existing?: PricingScheme;
  initial?: PricingFormInitial;
}) {
  const { t } = useT();
  const navigate = useNavigate();
  const posthog = usePostHog();
  const [clients, setClients] = useState<MockClient[]>([]);

  const loaded = useMemo(() => loadForm(existing), [existing]);

  const [name, setName] = useState(existing?.name ?? "");
  const [clientId, setClientId] = useState(existing?.client_id ?? initial?.clientId ?? "");
  const [schemeFor, setSchemeFor] = useState<SchemeFor>(initial?.schemeFor ?? loaded.schemeFor);
  const [effFrom, setEffFrom] = useState(
    existing?.effective_from ?? new Date().toISOString().slice(0, 10),
  );
  const [effTo, setEffTo] = useState(existing?.effective_to ?? "");
  const [category, setCategory] = useState<PricingCategory>(initial?.category ?? loaded.category);
  const [subtype, setSubtype] = useState<PricingSubtype>(
    initial?.category
      ? initial.category === "delivery"
        ? { distance: true, weight: false }
        : null
      : loaded.subtype,
  );
  const [f, setF] = useState<FormState>(() =>
    initial
      ? {
          ...loaded.form,
          cityScopeRaw: initial.cityScope ?? loaded.form.cityScopeRaw,
          revenueShareOn: initial.revenueShare ?? loaded.form.revenueShareOn,
        }
      : loaded.form,
  );
  // Modifier Tambahan (Add-KG/Multi-drop/Area City Pricing) — collapsed by
  // default, tapi auto-terbuka kalau skema yang lagi dibuka udah pakai salah
  // satu (biar gak nyembunyiin setting yang sedang aktif). Dihitung sekali dari
  // data awal (bukan reaktif ke f.*) — sekali user buka manual atau nutup lagi,
  // itu keputusan mereka, gak dipaksa balik oleh perubahan checkbox internal.
  const [modifiersOpen, setModifiersOpen] = useState(
    loaded.form.addKgOn || loaded.form.multiDropOn || loaded.form.deliveryIncentiveOn,
  );

  const [scopeAreas, setScopeAreas] = useState<string[]>([]);
  const [scopeHubs, setScopeHubs] = useState<string[]>([]);

  useEffect(() => {
    listClients().then(setClients);
  }, []);

  useEffect(() => {
    if (!clientId || category !== "delivery") return;
    const fetchScope = async (col: string) => {
      const { data } = await supabase
        .from("delivery_records")
        .select(col)
        .eq("client_id", clientId)
        .not(col, "is", null)
        .limit(5000);
      const rows = (data ?? []) as unknown as Record<string, string | null>[];
      return [...new Set(rows.map((r) => (r[col] ?? "").trim()).filter(Boolean))].sort();
    };
    fetchScope("city").then(setScopeAreas);
    fetchScope("sender_name").then(setScopeHubs);
  }, [clientId, category]);

  const patch = (p: Partial<FormState>) => setF((prev) => ({ ...prev, ...p }));

  const handleCategoryChange = (cat: PricingCategory) => {
    setCategory(cat);
    if (cat === "attendance") setSubtype(null);
    else if (cat === "delivery")
      setSubtype(
        (prev) => (prev as DeliveryDimensions | null) ?? { distance: true, weight: false },
      );
  };

  const [saving, setSaving] = useState(false);
  const handleSave = async () => {
    if (!effFrom) return toast.error(t("pform.effFromRequired"));
    if (category === "delivery" && f.deliveryIncentiveOn) {
      const err = validateDeliveryIncentiveState(f.deliveryIncentives);
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

  const selectedAreas = useMemo(() => new Set(citiesFromRaw(f.cityScopeRaw)), [f.cityScopeRaw]);
  const allAreas = useMemo(
    () => [...new Set([...scopeAreas, ...selectedAreas])].sort(),
    [scopeAreas, selectedAreas],
  );
  const toggleArea = (a: string) => {
    const next = new Set(selectedAreas);
    next.has(a) ? next.delete(a) : next.add(a);
    patch({ cityScopeRaw: [...next].join(", ") });
  };

  const selectedHubs = useMemo(() => new Set(citiesFromRaw(f.hubScopeRaw)), [f.hubScopeRaw]);
  const allHubs = useMemo(
    () => [...new Set([...scopeHubs, ...selectedHubs])].sort(),
    [scopeHubs, selectedHubs],
  );
  const toggleHub = (h: string) => {
    const next = new Set(selectedHubs);
    next.has(h) ? next.delete(h) : next.add(h);
    patch({ hubScopeRaw: [...next].join(", ") });
  };

  return (
    <AdminLayout
      title={mode === "create" ? t("pform.addSchemeTitle") : t("pform.editSchemeTitle")}
      subtitle={t("pform.pageSubtitle")}
    >
      <div className="pricing-workbench space-y-4">
        {/* ── Sticky header bar ── */}
        <div className="sticky top-0 z-10 -mx-1 px-1 py-2 bg-background/95 backdrop-blur-sm">
          <div className="flex items-center justify-between gap-3 rounded-lg border-[3px] border-border-strong bg-card px-4 py-2.5 shadow-[6px_6px_0_0_var(--color-border-strong)]">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => navigate({ to: "/admin/pricing" })}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground flex-shrink-0"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <span className="text-sm font-semibold truncate">
                {name ||
                  (mode === "create" ? t("pform.addSchemeTitle") : t("pform.editSchemeTitle"))}
              </span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={() => navigate({ to: "/admin/pricing" })}
                className="rounded-md border-2 border-border-strong bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
              >
                {t("pform.cancel")}
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-md border-2 border-border-strong bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium shadow-[3px_3px_0_0_var(--color-border-strong)] hover:opacity-90 disabled:opacity-50 transition-colors"
              >
                <Save className="w-3.5 h-3.5" />
                {saving ? t("pform.saving") : t("pform.saveScheme")}
              </button>
            </div>
          </div>
        </div>

        {/* ── Row 1: Identity + Period/Side ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-lg border-[3px] border-border-strong bg-card p-4 shadow-[6px_6px_0_0_var(--color-border-strong)] space-y-3">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">
              {t("pform.sectionBasicInfo")}
            </p>
            <div className="flex flex-col gap-1.5">
              <FieldLabel>
                {t("pform.schemeName")}{" "}
                <span className="font-normal text-muted-foreground">({t("pform.optional")})</span>
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
          </div>

          <div className="rounded-lg border-[3px] border-border-strong bg-card p-4 shadow-[6px_6px_0_0_var(--color-border-strong)] space-y-3">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">
              {t("pform.sectionSchemeType")}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <FieldLabel>{t("pform.effectiveFrom")}</FieldLabel>
                <DatePicker value={effFrom} onChange={setEffFrom} className="w-full" />
              </div>
              <div className="flex flex-col gap-1.5">
                <FieldLabel>
                  {t("pform.effectiveTo")}{" "}
                  <span className="font-normal">({t("pform.optional")})</span>
                </FieldLabel>
                <DatePicker value={effTo} onChange={setEffTo} className="w-full" />
              </div>
            </div>
            <div>
              <div className="mb-1.5">
                <FieldLabel>{t("pform.schemeForLabel")}</FieldLabel>
              </div>
              <div className="inline-flex rounded-md border-2 border-border-strong overflow-hidden">
                {(["rider", "client"] as SchemeFor[]).map((sf) => (
                  <button
                    key={sf}
                    data-pricing-side={sf}
                    type="button"
                    onClick={() => setSchemeFor(sf)}
                    className={
                      "px-3.5 py-1.5 text-xs font-medium transition-colors " +
                      (schemeFor === sf
                        ? "bg-primary text-primary-foreground"
                        : "bg-card text-foreground hover:bg-muted")
                    }
                  >
                    {sf === "rider" ? t("pform.riderCost") : t("pform.clientRevenue")}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── Row 2: Config strip — category + dimensions + scope ── */}
        <div className="rounded-lg border-[3px] border-border-strong bg-card p-4 shadow-[6px_6px_0_0_var(--color-border-strong)]">
          <div className="flex flex-wrap items-start gap-4">
            {/* Category toggle */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">
                {t("pform.selectCategory")}
              </span>
              <div className="inline-flex rounded-md border-2 border-border-strong overflow-hidden">
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
                        "flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium transition-colors " +
                        (active
                          ? "bg-primary text-primary-foreground"
                          : "bg-card text-foreground hover:bg-muted")
                      }
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {cat.name}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Dimension badges */}
            {category === "delivery" && !f.revenueShareOn && (
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">
                  {t("pform.pricingDimensionsLabel")}
                </span>
                <div className="flex gap-2">
                  {DELIVERY_DIMENSIONS.map((dim) => {
                    const Icon = DIMENSION_ICONS[dim.key];
                    const dims = (subtype as DeliveryDimensions) || {
                      distance: false,
                      weight: false,
                    };
                    const checked = dims[dim.key] ?? false;
                    return (
                      <label
                        key={dim.key}
                        data-pricing-dimension={dim.key}
                        className={
                          "inline-flex items-center gap-1.5 rounded-md border-2 border-border-strong px-3 py-1.5 text-xs font-medium cursor-pointer transition-all " +
                          (checked
                            ? "bg-primary text-primary-foreground shadow-[3px_3px_0_0_var(--color-border-strong)]"
                            : "bg-card text-foreground hover:bg-muted")
                        }
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => setSubtype({ ...dims, [dim.key]: e.target.checked })}
                          className="sr-only"
                        />
                        <Icon className="w-3.5 h-3.5" />
                        {dim.name}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Revenue share toggle (inline) */}
            {category === "delivery" && schemeFor === "rider" && (
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">
                  Revenue Share
                </span>
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={f.revenueShareOn}
                    onChange={(e) => patch({ revenueShareOn: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <span className="text-xs">{t("pform.revenueShareLabel")}</span>
                </label>
              </div>
            )}

            {/* Scope dropdowns */}
            {category === "delivery" && (
              <div className="flex flex-col gap-1.5 min-w-[160px]">
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">
                  Scope
                </span>
                <div className="flex gap-2">
                  <ScopeDropdown
                    label={`Area (${t("pform.optional")})`}
                    options={allAreas}
                    selected={selectedAreas}
                    onToggle={toggleArea}
                    emptyText={
                      clientId
                        ? "Tidak ada data area di pengiriman client ini."
                        : "Pilih client dulu."
                    }
                  />
                  <ScopeDropdown
                    label={`Hub (${t("pform.optional")})`}
                    options={allHubs}
                    selected={selectedHubs}
                    onToggle={toggleHub}
                    emptyText={
                      clientId
                        ? "Tidak ada data hub di pengiriman client ini."
                        : "Pilih client dulu."
                    }
                  />
                </div>
                {!f.cityScopeRaw && !f.hubScopeRaw && (
                  <span className="text-[10px] text-muted-foreground">
                    Skema utama — berlaku untuk semua Area &amp; Hub.
                  </span>
                )}
                {mode === "edit" && (
                  <Link
                    to="/admin/pricing/new"
                    search={{
                      clientId: clientId || undefined,
                      category: "delivery",
                      schemeFor,
                    }}
                    className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                  >
                    {t("pform.newScopedSchemeLink")} <ArrowUpRight className="w-3 h-3" />
                  </Link>
                )}
              </div>
            )}
          </div>

          {/* Callout */}
          <div className="mt-3 rounded-md border-2 border-border-strong bg-secondary px-3.5 py-2 flex items-start gap-2.5">
            <Info className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
            <p className="text-xs text-foreground leading-relaxed">
              {category === "delivery"
                ? (() => {
                    if (f.revenueShareOn) return t("pform.calloutRevenueShare");
                    const dims = subtype as DeliveryDimensions | null;
                    if (!dims || (!dims.distance && !dims.weight))
                      return PRICING_CATEGORIES.find((c) => c.key === category)!.callout;
                    const enabled = DELIVERY_DIMENSIONS.filter((d) => dims[d.key]).map(
                      (d) => d.name,
                    );
                    if (enabled.length === 1)
                      return DELIVERY_DIMENSIONS.find((d) => d.name === enabled[0])!.callout;
                    return t("pform.calloutBothDimensions");
                  })()
                : PRICING_CATEGORIES.find((c) => c.key === category)!.callout}
            </p>
          </div>
        </div>

        {/* ── Revenue Share fields (expanded when on) ── */}
        {category === "delivery" && schemeFor === "rider" && f.revenueShareOn && (
          <div className="rounded-lg border-[3px] border-border-strong bg-card p-4 shadow-[6px_6px_0_0_var(--color-border-strong)]">
            <div className="flex flex-col gap-1.5 max-w-xs">
              <FieldLabel>{t("pform.percentToRider")}</FieldLabel>
              <TextInput
                value={f.revenueSharePercent}
                inputMode="decimal"
                onChange={(e) =>
                  patch({ revenueSharePercent: sanitizeDecimalInput(e.target.value) })
                }
              />
            </div>
          </div>
        )}

        {/* ── Billing Add-ons ── */}
        {schemeFor === "client" && (
          <div className="rounded-lg border-[3px] border-border-strong bg-card p-4 shadow-[6px_6px_0_0_var(--color-border-strong)]">
            <ToggleBlock
              label={t("pform.billingAddonsLabel")}
              hint={t("pform.billingAddonsHint")}
              on={f.billingOn}
              onToggle={(on) => patch({ billingOn: on })}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
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
                      patch({
                        billing: {
                          ...f.billing,
                          management_fee_percent: sanitizeDecimalInput(e.target.value),
                        },
                      })
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
                          patch({
                            billing: {
                              ...f.billing,
                              insurance_fee_amount: sanitizeDecimalInput(e.target.value),
                            },
                          })
                        }
                      />
                    ) : (
                      <RupiahInput
                        value={f.billing.insurance_fee_amount}
                        onChange={(v) =>
                          patch({ billing: { ...f.billing, insurance_fee_amount: v } })
                        }
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
                      patch({
                        billing: {
                          ...f.billing,
                          ppn_percent: sanitizeDecimalInput(e.target.value),
                        },
                      })
                    }
                  />
                </div>
              </div>
            </ToggleBlock>
          </div>
        )}

        {/* ── Rate table (full width) ── */}
        <div className="rounded-lg border-[3px] border-border-strong bg-card p-4 shadow-[6px_6px_0_0_var(--color-border-strong)]">
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
              clientId={clientId}
            />
          )}

          {category === "attendance" && (
            <AttendanceFields value={f.attendance} onChange={(v) => patch({ attendance: v })} />
          )}
        </div>

        {/* ── Modifiers (collapsible) ── */}
        {category === "delivery" &&
          !f.revenueShareOn &&
          (() => {
            const activeCount = [f.addKgOn, f.multiDropOn, f.deliveryIncentiveOn].filter(
              Boolean,
            ).length;
            const hasActive = activeCount > 0;
            return (
              <div
                className={
                  "rounded-lg transition-colors " +
                  (hasActive
                    ? "border-[3px] border-primary bg-primary-soft shadow-[6px_6px_0_0_var(--color-border-strong)]"
                    : "border-[3px] border-border-strong bg-card shadow-[6px_6px_0_0_var(--color-border-strong)]")
                }
              >
                <button
                  type="button"
                  onClick={() => setModifiersOpen((o) => !o)}
                  className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left hover:bg-primary-soft/30 rounded-lg transition-colors"
                >
                  <span className="flex items-center gap-2.5">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground flex-shrink-0">
                      <SlidersHorizontal className="w-3.5 h-3.5" />
                    </span>
                    <ChevronRight
                      className={
                        "w-4 h-4 flex-shrink-0 transition-transform text-muted-foreground " +
                        (modifiersOpen ? "rotate-90" : "")
                      }
                    />
                    <span className="flex flex-col">
                      <span className="text-sm font-semibold leading-tight">
                        {t("pform.modifiersToggle")}
                      </span>
                      <span className="text-[11px] font-normal text-muted-foreground">
                        {t("pform.modifiersSubtitle")}
                      </span>
                    </span>
                  </span>
                  {hasActive && (
                    <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground flex-shrink-0">
                      {activeCount} {t("pform.modifiersActiveSuffix")}
                    </span>
                  )}
                </button>
                {modifiersOpen && (
                  <div className="px-4 pb-4 space-y-3">
                    {!(subtype as DeliveryDimensions | null)?.weight && (
                      <ToggleBlock
                        label={t("pform.addKgLabel")}
                        hint={t("pform.addKgHint")}
                        on={f.addKgOn}
                        onToggle={(on) => patch({ addKgOn: on })}
                      >
                        <StepTierEditor
                          unit="kg"
                          value={f.addKg}
                          onChange={(v) => patch({ addKg: v })}
                        />
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
                        <RupiahInput
                          value={f.multiDropFee}
                          onChange={(v) => patch({ multiDropFee: v })}
                        />
                      </div>
                    </ToggleBlock>

                    <ToggleBlock
                      label={t("pform.deliveryIncentiveLabel")}
                      hint={t("pform.deliveryIncentiveHint")}
                      on={f.deliveryIncentiveOn}
                      onToggle={(on) => patch({ deliveryIncentiveOn: on })}
                    >
                      <DeliveryIncentiveFields
                        value={f.deliveryIncentives}
                        onChange={(v) => patch({ deliveryIncentives: v })}
                      />
                    </ToggleBlock>
                  </div>
                )}
              </div>
            );
          })()}

        {/* ── Calculator simulator ── */}
        {!(category === "delivery" && f.revenueShareOn) && (
          <div className="rounded-lg border-[3px] border-border-strong bg-card p-4 shadow-[6px_6px_0_0_var(--color-border-strong)]">
            <InteractiveCalc
              category={category}
              subtype={subtype}
              delivery={f.delivery}
              attendance={f.attendance}
              schemeFor={schemeFor}
              addKgOn={f.addKgOn}
              multiDropOn={f.multiDropOn}
              multiDropFee={f.multiDropFee}
              billingOn={f.billingOn}
            />
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
