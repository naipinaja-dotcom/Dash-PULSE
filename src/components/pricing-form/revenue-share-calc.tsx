// Kalkulator preview khusus skema Revenue Share (Rider). Beda dari
// InteractiveCalc biasa: revenue-nya BUKAN diisi manual, tapi dihitung dari
// skema Client (Per Pengiriman) yang aktif buat client & periode yang sama —
// persis logic yang dipakai admin.calculate.tsx pas Hitung Fee beneran.
import { useEffect, useMemo, useState } from "react";
import { Calculator } from "lucide-react";
import { Loader2 } from "lucide-react";
import { useT } from "@/lib/i18n";
import { listPricingSchemes } from "@/lib/pricing-store";
import type { PricingScheme } from "@/lib/pricing-types";
import { formatRupiah } from "@/lib/format";
import { emptyAttendanceState } from "./attendance-fields";
import { loadDeliveryState } from "./delivery-fields";
import {
  DeliveryCalcInputs,
  computeInteractive,
  defaultCalcInputs,
  type CalcInputs,
  type InteractiveCalcProps,
} from "./interactive-calc";

function findClientScheme(schemes: PricingScheme[], clientId: string, from: string, to: string): PricingScheme | null {
  const to_ = to || from;
  const candidates = schemes.filter(
    (s) =>
      s.scheme_for === "client" &&
      s.client_id === clientId &&
      s.category === "delivery" &&
      s.effective_from <= to_ &&
      (!s.effective_to || s.effective_to >= from),
  );
  // Kalau lebih dari satu overlap (jarang, tapi bisa), pakai yang paling baru.
  return candidates.sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))[0] ?? null;
}

function buildClientCalcProps(scheme: PricingScheme): InteractiveCalcProps {
  const env = scheme.params;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const config = env.config as any;
  return {
    category: "delivery",
    subtype: scheme.subtype,
    delivery: loadDeliveryState(scheme.subtype, env.type, config),
    attendance: emptyAttendanceState(),
    schemeFor: "client",
    addKgOn: !!env.add_kg,
    multiDropOn: !!env.multi_drop,
    multiDropFee: String(env.multi_drop?.fee_per_extra_shipment ?? ""),
    billingOn: !!env.billing_addons,
  };
}

export function RevenueShareCalc({
  clientId,
  effFrom,
  effTo,
  percentToRider,
}: {
  clientId: string;
  effFrom: string;
  effTo: string;
  percentToRider: string;
}) {
  const { t } = useT();
  const [schemes, setSchemes] = useState<PricingScheme[] | null>(null);

  useEffect(() => {
    listPricingSchemes().then(setSchemes);
  }, []);

  const clientScheme = useMemo(
    () => (schemes && clientId ? findClientScheme(schemes, clientId, effFrom, effTo) : null),
    [schemes, clientId, effFrom, effTo],
  );

  const calcProps = useMemo(() => (clientScheme ? buildClientCalcProps(clientScheme) : null), [clientScheme]);

  const [inp, setInp] = useState<CalcInputs | null>(null);
  useEffect(() => {
    setInp(calcProps ? defaultCalcInputs(calcProps) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientScheme?.id]);

  const result = useMemo(() => (calcProps && inp ? computeInteractive(calcProps, inp) : null), [calcProps, inp]);

  const header = (
    <div className="flex items-center gap-2 mb-3">
      <Calculator className="w-4 h-4 text-primary" />
      <p className="text-xs font-semibold text-foreground">{t("pfRevShare.calculatorTitle")}</p>
      <span className="text-[10px] text-muted-foreground">{t("pfRevShare.calculatorHint")}</span>
    </div>
  );

  if (schemes === null) {
    return (
      <div className="rounded-md border-2 border-border-strong bg-card shadow-[3px_3px_0_0_var(--color-border-strong)] px-4 py-3.5">
        {header}
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t("pfRevShare.loadingSchemes")}
        </p>
      </div>
    );
  }

  if (!clientId) {
    return (
      <div className="rounded-md border-2 border-border-strong bg-card shadow-[3px_3px_0_0_var(--color-border-strong)] px-4 py-3.5">
        {header}
        <p className="text-xs text-muted-foreground">{t("pfRevShare.selectClientFirst")}</p>
      </div>
    );
  }

  if (!clientScheme || !calcProps || !inp || !result) {
    return (
      <div className="rounded-md border-2 border-border-strong bg-card shadow-[3px_3px_0_0_var(--color-border-strong)] px-4 py-3.5">
        {header}
        <p className="text-xs text-muted-foreground">{t("pfRevShare.noActiveClientScheme")}</p>
      </div>
    );
  }

  const revenue = result.total.amount;
  const pctRider = Math.max(0, Math.min(100, Number(percentToRider) || 0));
  const riderFee = Math.round(revenue * (pctRider / 100));
  const margin = revenue - riderFee;
  const pctMargin = 100 - pctRider;

  return (
    <div className="rounded-md border-2 border-border-strong bg-card shadow-[3px_3px_0_0_var(--color-border-strong)] px-4 py-3.5">
      {header}

      <p className="text-[11px] text-muted-foreground mb-2">
        {t("pfRevShare.clientSchemeUsed")} <span className="font-medium text-foreground">{clientScheme.name}</span>
      </p>

      <div className="mb-3.5">
        <DeliveryCalcInputs props={calcProps} inp={inp} onChange={(p) => setInp((prev) => (prev ? { ...prev, ...p } : prev))} />
      </div>

      {/* Breakdown revenue client — apa adanya dari skema Client */}
      <div className="border-t border-border-strong pt-2.5 space-y-1 mb-3">
        {result.steps.map((s, i) => (
          <div key={i} className="flex items-baseline justify-between gap-3 text-xs">
            <span className="text-muted-foreground">{s.text}</span>
            {s.amount !== undefined && <span className="font-medium tabular-nums whitespace-nowrap">{formatRupiah(s.amount)}</span>}
          </div>
        ))}
        <div className="flex items-center justify-between gap-3 mt-2 pt-2 border-t border-border-strong">
          <span className="text-xs font-semibold">{t("pfRevShare.revenueClient")}</span>
          <span className="text-base font-bold text-primary tabular-nums">{formatRupiah(revenue)}</span>
        </div>
      </div>

      {/* Split bar — proporsi visual rider vs margin */}
      <div className="h-3 w-full rounded-full overflow-hidden border-2 border-border-strong flex mb-3">
        <div className="bg-primary h-full transition-all" style={{ width: `${pctRider}%` }} />
        <div className="bg-muted h-full transition-all" style={{ width: `${pctMargin}%` }} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-md border-2 border-border-strong bg-primary text-primary-foreground px-3 py-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-wide opacity-90">{t("pfRevShare.feeRiderLabel")} · {pctRider}%</div>
          <div className="text-base font-bold tabular-nums mt-0.5">{formatRupiah(riderFee)}</div>
        </div>
        <div className="rounded-md border-2 border-border-strong bg-muted text-foreground px-3 py-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{t("pfRevShare.marginLabel")} · {pctMargin}%</div>
          <div className="text-base font-bold tabular-nums mt-0.5">{formatRupiah(margin)}</div>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground mt-3">{t("pfRevShare.previewDisclaimer")}</p>
    </div>
  );
}
