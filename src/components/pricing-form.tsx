// Shell: info card, tombol save, pemilihan kategori/subtype. Field per
// kategori dipecah ke pricing-form/delivery-fields.tsx (kategori 1),
// pricing-form/attendance-fields.tsx (kategori 2), kalkulator interaktif ke
// pricing-form/interactive-calc.tsx.
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { usePostHog } from "@posthog/react";
import { AdminLayout } from "@/components/admin-layout";
import { ClientCombobox } from "@/components/client-combobox";
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
import { parseRupiah } from "@/lib/format";
import {
  ArrowLeft,
  Info,
  Truck,
  Ruler,
  Package,
  CalendarDays,
  Save,
  Layers,
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
import {
  InteractiveCalc,
  emptyHybridState,
  type HybridState,
} from "./pricing-form/interactive-calc";
import { loadDeliveryCompState } from "./pricing-form/attendance-delivery-comp";

const CATEGORY_ICONS = { Truck, CalendarDays, Layers } as const;
const DIMENSION_ICONS = { distance: Ruler, weight: Package } as const;

// -------------------- Bentuk state form (semua string, di-parse saat simpan) --------------------
interface FormState {
  delivery: DeliveryState;
  attendance: AttendanceState;
  hybrid: HybridState;
  addKgOn: boolean;
  addKg: StepTierState;
  multiDropOn: boolean;
  multiDropFee: string;
  billingOn: boolean;
  billing: { min_charge: string; admin_fee_flat: string; management_fee_percent: string; ppn_percent: string };
}

function emptyForm(): FormState {
  return {
    delivery: emptyDeliveryState(),
    attendance: emptyAttendanceState(),
    hybrid: emptyHybridState(),
    addKgOn: false,
    addKg: emptyStepTier(),
    multiDropOn: false,
    multiDropFee: "3000",
    billingOn: false,
    billing: { min_charge: "", admin_fee_flat: "", management_fee_percent: "", ppn_percent: "11" },
  };
}

function buildEnvelope(
  category: PricingCategory,
  subtype: PricingSubtype,
  schemeFor: SchemeFor,
  f: FormState,
): PricingEnvelope {
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
    billing_addons:
      schemeFor === "client" && f.billingOn
        ? {
            min_charge: parseRupiah(f.billing.min_charge),
            admin_fee_flat: parseRupiah(f.billing.admin_fee_flat),
            management_fee_percent: Number(f.billing.management_fee_percent) || 0,
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
  const category: PricingCategory = scheme?.category ?? "delivery";
  const subtype: PricingSubtype = scheme?.subtype ?? (category === "delivery" ? { distance: true, weight: false } : null);

  if (!scheme || !scheme.params || scheme.params.version !== 1) {
    return { form, category, subtype, schemeFor: scheme?.scheme_for ?? "rider" };
  }

  const env = scheme.params;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = env.config as any;

  if (category === "delivery") {
    form.delivery = loadDeliveryState(subtype, env.type, c);
  } else if (category === "attendance") {
    form.attendance = loadAttendanceState(c);
  } else if (category === "hybrid") {
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
  if (env.billing_addons) {
    form.billingOn = true;
    form.billing = {
      min_charge: String(env.billing_addons.min_charge ?? ""),
      admin_fee_flat: String(env.billing_addons.admin_fee_flat ?? ""),
      management_fee_percent: String(env.billing_addons.management_fee_percent ?? ""),
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
      <AdminLayout title="Edit Skema Pricing">
        <div className="p-10 text-center text-muted-foreground text-sm">Memuat skema…</div>
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
    if (!effFrom) return toast.error("Tanggal berlaku dari wajib diisi");
    // Nama opsional — kalau dikosongin, dibikinin otomatis dari client + sisi + tipe.
    const activeCategory = PRICING_CATEGORIES.find((c) => c.key === category)!;
    const autoName = [
      clients.find((c) => c.id === clientId)?.name ?? "Semua Client",
      schemeFor === "client" ? "Client" : "Rider",
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
      toast.success(mode === "create" ? "Skema berhasil dibuat" : "Skema berhasil diperbarui");
      navigate({ to: "/admin/pricing" });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminLayout
      title={mode === "create" ? "Tambah Skema Pricing" : "Edit Skema Pricing"}
      subtitle="Atur cara kalkulasi harga — sisi rider (cost) atau client (revenue)."
    >
      <button
        type="button"
        onClick={() => navigate({ to: "/admin/pricing" })}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Kembali ke daftar
      </button>

      {/* Info card */}
      <div className="rounded-xl border border-border bg-card p-5 mb-4 shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
          <div className="flex flex-col gap-1.5">
            <FieldLabel>
              Nama Skema <span className="font-normal text-muted-foreground">(opsional)</span>
            </FieldLabel>
            <TextInput
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Kosongin = otomatis dari client + sisi + tipe"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel>Client</FieldLabel>
            <ClientCombobox
              value={clientId}
              onChange={setClientId}
              placeholder="Semua Client"
              className="w-full text-sm py-1.5"
              options={clients.map((c) => ({ value: c.id, label: c.name }))}
            />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <FieldLabel>Berlaku Dari</FieldLabel>
            <TextInput type="date" value={effFrom} onChange={(e) => setEffFrom(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel>
              Berlaku Sampai <span className="font-normal">(opsional)</span>
            </FieldLabel>
            <TextInput type="date" value={effTo} onChange={(e) => setEffTo(e.target.value)} />
          </div>
        </div>

        {/* Scheme for */}
        <div className="mt-3">
          <p className="text-xs font-medium text-muted-foreground mb-1.5">Skema untuk</p>
          <div className="grid grid-cols-2 gap-2">
            {(["rider", "client"] as SchemeFor[]).map((sf) => (
              <button
                key={sf}
                type="button"
                onClick={() => setSchemeFor(sf)}
                className={
                  "text-left rounded-md px-3 py-2.5 border transition-colors " +
                  (schemeFor === sf
                    ? "border-2 border-primary bg-primary-soft"
                    : "border-border hover:border-primary-border hover:bg-primary-soft/40")
                }
              >
                <span className="text-xs font-medium block">
                  {sf === "rider" ? "Rider (Cost)" : "Client (Revenue)"}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {sf === "rider" ? "Fee yang dibayar ke rider" : "Harga yang ditagih ke client"}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Category + subtype chooser + dynamic params */}
      <div className="rounded-xl border border-border bg-card p-5 mb-4 shadow-sm">
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">
          Pilih kategori
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-4">
          {PRICING_CATEGORIES.map((cat) => {
            const Icon = CATEGORY_ICONS[cat.icon as keyof typeof CATEGORY_ICONS] ?? Truck;
            const active = category === cat.key;
            return (
              <button
                key={cat.key}
                type="button"
                onClick={() => handleCategoryChange(cat.key)}
                className={
                  "text-left rounded-lg px-3 py-3 flex flex-col gap-1 transition-all duration-150 border " +
                  (active
                    ? "border-2 border-primary bg-primary-soft shadow-sm shadow-primary/10"
                    : "border-border hover:border-primary-border/60 hover:bg-primary-soft/20 hover:shadow-sm")
                }
              >
                <Icon className="w-4 h-4 text-primary" />
                <span className="text-xs font-medium leading-tight">{cat.name}</span>
                <span className="text-[11px] text-muted-foreground leading-snug">{cat.desc}</span>
              </button>
            );
          })}
        </div>

        {/* Dimensi delivery — checkbox Distance / Weight */}
        {category === "delivery" && (
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-2">
              Dimensi Pricing (pilih satu atau dua):
            </label>
            <div className="grid grid-cols-2 gap-2 mb-4">
              {DELIVERY_DIMENSIONS.map((dim) => {
                const Icon = DIMENSION_ICONS[dim.key];
                const dims = (subtype as DeliveryDimensions) || { distance: false, weight: false };
                const checked = dims[dim.key] ?? false;

                return (
                  <label
                    key={dim.key}
                    className={
                      "text-left rounded-lg px-3 py-2.5 flex items-start gap-2.5 transition-all duration-150 border cursor-pointer " +
                      (checked
                        ? "border-primary bg-primary-soft shadow-sm shadow-primary/10"
                        : "border-border hover:border-primary-border/60 hover:bg-primary-soft/20")
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
                        <Icon className="w-3.5 h-3.5 text-primary flex-shrink-0" />
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
        <div className="rounded-md border border-primary-border bg-primary-soft px-3.5 py-2.5 mb-4 flex items-start gap-2.5">
          <Info className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
          <p className="text-xs text-primary-soft-foreground leading-relaxed">
            {category === "delivery"
              ? (() => {
                  const dims = subtype as DeliveryDimensions | null;
                  if (!dims || (!dims.distance && !dims.weight)) return PRICING_CATEGORIES.find((c) => c.key === category)!.callout;
                  const enabled = DELIVERY_DIMENSIONS.filter((d) => dims[d.key]).map((d) => d.name);
                  if (enabled.length === 1) return DELIVERY_DIMENSIONS.find((d) => d.name === enabled[0])!.callout;
                  return "Distance + Weight aktif — masing-masing punya tabel range sendiri, hasilnya dijumlah (sum).";
                })()
              : PRICING_CATEGORIES.find((c) => c.key === category)!.callout}
          </p>
        </div>

        {/* ===== DELIVERY ===== */}
        {category === "delivery" && subtype && (
          <DeliveryFields
            subtype={subtype}
            value={f.delivery}
            onChange={(v) => patch({ delivery: v })}
          />
        )}

        {/* ===== ATTENDANCE ===== */}
        {category === "attendance" && (
          <AttendanceFields value={f.attendance} onChange={(v) => patch({ attendance: v })} />
        )}

        <InteractiveCalc
          category={category}
          subtype={subtype}
          delivery={f.delivery}
          attendance={f.attendance}
          hybrid={f.hybrid}
          schemeFor={schemeFor}
          addKgOn={f.addKgOn}
          multiDropOn={f.multiDropOn}
          multiDropFee={f.multiDropFee}
          billingOn={f.billingOn}
        />
      </div>

      {/* ===== MODIFIERS ===== */}
      <div className="rounded-xl border border-border bg-card p-5 mb-4 space-y-3 shadow-sm">
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">
          Modifier (opsional)
        </p>

        {category === "delivery" && !(subtype as DeliveryDimensions | null)?.weight && (
          <ToggleBlock
            label="Add-KG (surcharge berat)"
            hint="Biaya tambahan berdasarkan berat, bertingkat. Nonaktif otomatis kalau dimensi Weight sudah dipakai (biar gak double-count)."
            on={f.addKgOn}
            onToggle={(on) => patch({ addKgOn: on })}
          >
            <StepTierEditor unit="kg" value={f.addKg} onChange={(v) => patch({ addKg: v })} />
          </ToggleBlock>
        )}

        {category === "delivery" && (
          <ToggleBlock
            label="Multi-drop (kiriman ke-2 dst)"
            hint="Otomatis mulai kiriman ke-2 dalam hari yang sama, per rider."
            on={f.multiDropOn}
            onToggle={(on) => patch({ multiDropOn: on })}
          >
            <div className="flex flex-col gap-1.5 max-w-xs">
              <FieldLabel>Fee per kiriman ekstra (Rp)</FieldLabel>
              <RupiahInput value={f.multiDropFee} onChange={(v) => patch({ multiDropFee: v })} />
            </div>
          </ToggleBlock>
        )}

        {schemeFor === "client" && (
          <ToggleBlock
            label="Billing Add-ons (khusus client)"
            hint="Urutan hitung: min charge (lantai) → + management fee (% operational) → + admin fee → × (1 + PPN%). PPN paling akhir. Management/PPN kosong = gak muncul di invoice."
            on={f.billingOn}
            onToggle={(on) => patch({ billingOn: on })}
          >
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="flex flex-col gap-1.5">
                <FieldLabel>Min Charge (Rp)</FieldLabel>
                <RupiahInput
                  value={f.billing.min_charge}
                  onChange={(v) => patch({ billing: { ...f.billing, min_charge: v } })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <FieldLabel>Management Fee (%)</FieldLabel>
                <TextInput
                  value={f.billing.management_fee_percent}
                  inputMode="decimal"
                  onChange={(e) =>
                    patch({ billing: { ...f.billing, management_fee_percent: e.target.value } })
                  }
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <FieldLabel>Admin Fee (Rp)</FieldLabel>
                <RupiahInput
                  value={f.billing.admin_fee_flat}
                  onChange={(v) => patch({ billing: { ...f.billing, admin_fee_flat: v } })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <FieldLabel>PPN (%)</FieldLabel>
                <TextInput
                  value={f.billing.ppn_percent}
                  inputMode="decimal"
                  onChange={(e) =>
                    patch({ billing: { ...f.billing, ppn_percent: e.target.value } })
                  }
                />
              </div>
            </div>
          </ToggleBlock>
        )}
      </div>

      {/* Footer */}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => navigate({ to: "/admin/pricing" })}
          className="rounded-md border border-border bg-card px-4 py-2 text-sm hover:bg-muted"
        >
          Batal
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          {saving ? "Menyimpan…" : "Simpan Skema"}
        </button>
      </div>
    </AdminLayout>
  );
}
