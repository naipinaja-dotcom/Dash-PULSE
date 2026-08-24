// Ubah PricingScheme (params/envelope) jadi "rate card" yang kebaca manusia —
// dipakai di halaman Reports (tampil ke Finance) + ikut di-export.
// Dirender JUJUR sesuai yang tersimpan di scheme, jadi angkanya = angka yang
// beneran dipakai engine ngitung fee. Tidak ada input manual di sini.
import type { PricingScheme, PricingEnvelope, StepTier, RangeRow, ModularDeliveryConfig } from "./pricing-types";
import { calcScheme, type DeliveryRow } from "./pricing-calc";

// Baris pengiriman ilustratif buat contoh Revenue Share — dipilih angka yang
// "masuk akal" (10km, 3kg), bukan data real. Cuma buat kasih gambaran Rupiah
// di summary; angka aktual tetap dihitung ulang pas Hitung Fee beneran.
const EXAMPLE_DELIVERY_ROW: DeliveryRow = {
  delivery_date: "2026-01-01",
  distance_km: 10,
  weight_kg: 3,
  status: "completed",
  delivery_type: "DELIVERY",
};

export interface RateRow {
  variable: string;
  rate: string;
  unit: string;
  remarks: string;
}
export interface RateSection {
  title?: string;
  rows: RateRow[];
}
export interface RateCard {
  schemeName: string;
  calcType: PricingEnvelope["type"];
  calcLabel: string;
  clientName: string | null;
  schemeFor: PricingScheme["scheme_for"];
  sections: RateSection[];
}

const rp = (n: unknown) => "Rp" + Math.round(Number(n) || 0).toLocaleString("id-ID");
const num = (n: unknown) => (Number(n) || 0).toLocaleString("id-ID");

const CALC_LABEL: Record<PricingEnvelope["type"], string> = {
  flat_unit: "Flat per Unit",
  tier: "Tier Jarak & Berat",
  tier_daily: "Akumulasi Harian",
  threshold_multiple: "Threshold Kelipatan",
  modular_v2: "Distance / Weight",
  attendance: "Daily / Attendance",
  combined: "Combined (Daily + Per Order)",
  revenue_share: "Revenue Share (% Client)",
};

// StepTier → baris band yang kebaca. `unit` mis "km" / "kg".
function stepTierRows(tier: StepTier | null | undefined, unit: string): RateRow[] {
  if (!tier) return [];
  const rows: RateRow[] = [];
  const baseUntil = Number(tier.base_until) || 0;
  rows.push({
    variable: baseUntil > 0 ? `Dasar (s/d ${num(baseUntil)} ${unit})` : "Dasar",
    rate: rp(tier.base_fee),
    unit: baseUntil > 0 ? `sampai ${num(baseUntil)} ${unit}` : "flat",
    remarks: "",
  });
  for (const t of tier.tiers || []) {
    const from = Number(t.from) || 0;
    const to = t.to === null || t.to === undefined ? null : Number(t.to);
    const step = Number(t.step) || 1;
    rows.push({
      variable: to === null ? `> ${num(from)} ${unit}` : `${num(from)} – ${num(to)} ${unit}`,
      rate: `+${rp(t.add_per_step)}`,
      unit: step === 1 ? `per ${unit}` : `per ${num(step)} ${unit}`,
      remarks: "",
    });
  }
  return rows;
}

// RangeRow[] (band-independent, dipakai skema modular_v2) → baris yang kebaca.
function rangeRowsToRateRows(rows: RangeRow[], unit: string): RateRow[] {
  return rows.map((r) => {
    const variable = r.to === null ? `> ${num(r.from)} ${unit}` : `${num(r.from)} – ${num(r.to)} ${unit}`;
    if (r.type === "flat") {
      return { variable, rate: rp(r.base_fee), unit: "flat", remarks: "" };
    }
    const step = r.step || 1;
    return {
      variable,
      rate: `${rp(r.base_fee)} +${rp(r.add_per_step)}`,
      unit: step === 1 ? `per ${unit}` : `per ${num(step)} ${unit}`,
      remarks: "Base + kelipatan step dari awal band",
    };
  });
}

// Modifier universal (add_kg / multi_drop / billing) → section tambahan.
function modifierSections(env: PricingEnvelope): RateSection[] {
  const out: RateSection[] = [];
  if (env.add_kg) {
    out.push({ title: "Surcharge berat (Add-KG)", rows: stepTierRows(env.add_kg.tier, "kg") });
  }
  if (env.multi_drop) {
    out.push({
      title: "Multi-drop",
      rows: [{
        variable: "Kiriman ke-2 dst (per hari)",
        rate: rp(env.multi_drop.fee_per_extra_shipment),
        unit: "per kiriman",
        remarks: "Otomatis mulai kiriman ke-2 per rider per hari",
      }],
    });
  }
  if (env.billing_addons) {
    const b = env.billing_addons;
    out.push({
      title: "Billing (tagihan client)",
      rows: [
        { variable: "Minimum charge", rate: rp(b.min_charge), unit: "lantai", remarks: "Kalau subtotal di bawah ini, dinaikkan ke sini" },
        { variable: "Admin fee", rate: rp(b.admin_fee_flat), unit: "flat", remarks: "" },
        { variable: "PPN", rate: `${num(b.ppn_percent)}%`, unit: "", remarks: "Dihitung paling akhir" },
      ],
    });
  }
  return out;
}

export function describeScheme(scheme: PricingScheme, linkedClientScheme?: PricingScheme): RateCard {
  const env = scheme.params;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cfg = (env?.config ?? {}) as any;
  const sections: RateSection[] = [];

  switch (env?.type) {
    case "flat_unit": {
      const unitLabel = cfg.unit === "unique_address" ? "per alamat unik" : "per kiriman";
      if (cfg.rate_by === "flat") {
        sections.push({ rows: [{ variable: "Tarif flat", rate: rp(cfg.flat_rate), unit: unitLabel, remarks: "" }] });
      } else {
        const rows: RateRow[] = (cfg.rates || []).map((x: { key: string; rate: number }) => ({
          variable: String(x.key), rate: rp(x.rate), unit: unitLabel, remarks: "",
        }));
        rows.push({ variable: "(lainnya / default)", rate: rp(cfg.default_rate), unit: unitLabel, remarks: `Acuan kolom: ${cfg.match_column ?? "-"}` });
        sections.push({ title: "Tarif per " + (cfg.match_column ?? "kategori"), rows });
      }
      break;
    }
    case "tier":
    case "tier_daily": {
      const note = env.type === "tier_daily" ? " (akumulasi 1 hari dijumlah dulu)" : "";
      if (cfg.distance) sections.push({ title: "Tarif jarak" + note, rows: stepTierRows(cfg.distance, "km") });
      if (cfg.weight) sections.push({ title: "Tarif berat" + note, rows: stepTierRows(cfg.weight, "kg") });
      break;
    }
    case "modular_v2": {
      const mcfg: ModularDeliveryConfig = cfg;
      if (mcfg.distance?.enabled) {
        const note = mcfg.distance.accumulate === "daily" ? " (akumulasi 1 hari dijumlah dulu)" : "";
        sections.push({ title: "Tarif jarak" + note, rows: rangeRowsToRateRows(mcfg.distance.rows, "km") });
      }
      if (mcfg.weight?.enabled) {
        if (mcfg.weight.mode === "threshold_group" && mcfg.weight.threshold) {
          const th = mcfg.weight.threshold;
          const rows: RateRow[] = (th.rules || []).map((x) => ({
            variable: String(x.key), rate: rp(x.rate), unit: `tiap kelipatan ${num(x.threshold)} kg`, remarks: "",
          }));
          rows.push({
            variable: "(lainnya / default)",
            rate: rp(th.default_rate),
            unit: `tiap kelipatan ${num(th.default_threshold)} kg`,
            remarks: `Grup: ${th.group_by ?? "-"}`,
          });
          sections.push({ title: "Tarif berat — Kelipatan per Store", rows });
        } else {
          const note = mcfg.weight.accumulate === "daily" ? " (akumulasi 1 hari dijumlah dulu)" : "";
          sections.push({ title: "Tarif berat" + note, rows: rangeRowsToRateRows(mcfg.weight.rows, "kg") });
        }
      }
      if (mcfg.rate_by !== "flat") {
        const label = mcfg.rate_by === "delivery_type" ? "Antar / Kembali" : (mcfg.match_column || "kolom");
        const rows: RateRow[] = (mcfg.rates || []).map((x) => ({
          variable: String(x.key), rate: rp(x.rate), unit: "override baris Flat", remarks: "",
        }));
        sections.push({ title: `Override tarif per ${label} (baris Flat)`, rows });
      }
      break;
    }
    case "threshold_multiple": {
      const rows: RateRow[] = (cfg.rules || []).map((x: { key: string; threshold: number; rate: number }) => ({
        variable: String(x.key),
        rate: rp(x.rate),
        unit: `tiap kelipatan ${num(x.threshold)} kg`,
        remarks: "",
      }));
      if (cfg.default) {
        rows.push({
          variable: "(lainnya / default)",
          rate: rp(cfg.default.rate),
          unit: `tiap kelipatan ${num(cfg.default.threshold)} kg`,
          remarks: `Grup: ${cfg.group_by ?? "-"}`,
        });
      }
      sections.push({ title: "Tarif per store/area", rows });
      break;
    }
    case "attendance": {
      const attRows: RateRow[] = [
        { variable: "Daily Rate", rate: rp(cfg.full_fee), unit: "per hari", remarks: `Jam standar ${num((Number(cfg.standard_minutes) || 0) / 60)} jam (pro-rata)` },
      ];
      if (cfg.overtime?.enabled) {
        attRows.push({ variable: "Lembur", rate: rp(cfg.overtime.rate_per_hour), unit: "per jam", remarks: "Kelebihan di atas jam standar" });
      }
      sections.push({ title: "Fee harian", rows: attRows });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const incs: any[] = cfg.incentives ?? [];
      if (incs.length) {
        sections.push({
          title: "Insentif",
          rows: incs.map((inc) => ({
            variable: String(inc.name ?? "Insentif"),
            rate: rp(inc.amount),
            unit: "per hari",
            remarks: inc.condition === "ontime_only" ? "Hanya kalau ONTIME" : "Selalu",
          })),
        });
      }
      break;
    }
    case "revenue_share": {
      const rows: RateRow[] = [
        {
          variable: "Fee Rider",
          rate: `${num(cfg.percent_to_rider)}%`,
          unit: "dari revenue Client",
          remarks: "Revenue diambil dari skema Client aktif saat Hitung Fee, bukan tabel tarif di sini",
        },
      ];
      if (linkedClientScheme) {
        const exampleRevenue = calcScheme(linkedClientScheme.params, [EXAMPLE_DELIVERY_ROW]).perRow[0]?.fee ?? 0;
        const pct = Number(cfg.percent_to_rider) || 0;
        const exampleFee = Math.round(exampleRevenue * (pct / 100));
        rows.push({
          variable: "Contoh (10 km, 3 kg)",
          rate: rp(exampleFee),
          unit: `dari revenue ${rp(exampleRevenue)}`,
          remarks: `Ilustrasi pakai skema Client "${linkedClientScheme.name}" saat ini — bukan angka final`,
        });
      }
      sections.push({ rows });
      break;
    }
    case "combined": {
      const daily: RateRow[] = [
        { variable: "Daily Rate", rate: rp(cfg.full_fee), unit: "per hari", remarks: `Min ${num((Number(cfg.standard_minutes) || 0) / 60)} jam (pro-rata jam kerja)` },
      ];
      if (Number(cfg.ontime_bonus) > 0) {
        daily.push({ variable: "Bonus ontime", rate: rp(cfg.ontime_bonus), unit: "per hari", remarks: "Hanya kalau ONTIME" });
      }
      sections.push({ title: "Fee harian", rows: daily });
      const orderUnit = cfg.order_by === "weight" ? "kg" : "km";
      const orderRows = stepTierRows(cfg.order_tier, orderUnit);
      if (orderRows.length) sections.push({ title: "Order incentive — per order ikut " + orderUnit, rows: orderRows });
      break;
    }
    default:
      sections.push({ rows: [{ variable: "(skema belum dikenali)", rate: "-", unit: "", remarks: "Versi params lama" }] });
  }

  sections.push(...modifierSections(env));

  return {
    schemeName: scheme.name,
    calcType: env?.type,
    calcLabel: CALC_LABEL[env?.type] ?? String(env?.type ?? "-"),
    clientName: scheme.client_name ?? null,
    schemeFor: scheme.scheme_for,
    sections,
  };
}
