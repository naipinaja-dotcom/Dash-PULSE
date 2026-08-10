import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { usePostHog } from "@posthog/react";
import { RiderLayout } from "@/components/rider-layout";
import { supabase } from "@/integrations/supabase/client";
import { useRiderSelf } from "@/lib/use-rider-self";
import { useT } from "@/lib/i18n";
import { formatRupiah, formatTanggal } from "@/lib/format";
import { Loader2, X, ChevronRight, ChevronDown, Download } from "lucide-react";
import { PayslipPrint } from "@/components/payslip-print";
import { EarningsChecker } from "@/components/earnings-checker";

export const Route = createFileRoute("/rider/payslips")({ component: PayslipsPage });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

type PayslipRow = {
  id: string;
  detail_id: string;
  run_id: string;
  published_at: string;
  data: { delivery_count: number; gross_earning: number; total_deduction: number; net_pay: number };
  payroll_runs: { name: string; period_start: string; period_end: string } | null;
};

type ClientSummary = {
  detail_id: string;
  client_id: string;
  client_name: string;
  delivery_count: number;
  gross_earning: number;
};

type PaymentHoldStatus = "held" | "released";

type DeliveryRow = {
  id: string;
  delivery_date: string;
  awb: string | null;
  dash_delivery_id: string | null;
  delivery_type: string | null;
  service_type: string | null;
  distance_km: number | null;
  weight_kg: number | null;
  district: string | null;
  receiver_name: string | null;
  destination_address: string | null;
  fee: number;
  status: string | null;
};

function PayslipsPage() {
  const { t } = useT();
  const posthog = usePostHog();
  const { rider, loading: riderLoading } = useRiderSelf();
  const [slips, setSlips] = useState<PayslipRow[]>([]);
  const [paymentHolds, setPaymentHolds] = useState<Record<string, PaymentHoldStatus>>({});
  const [loading, setLoading] = useState(true);
  const [openSlip, setOpenSlip] = useState<PayslipRow | null>(null);

  useEffect(() => {
    if (!rider) {
      setLoading(false);
      return;
    }
    sb.from("payslips")
      .select(
        "id, detail_id, run_id, published_at, data, payroll_runs(name, period_start, period_end)",
      )
      .eq("rider_id", rider.id)
      .order("published_at", { ascending: false })
      .then(async ({ data }: { data: PayslipRow[] | null }) => {
        const rows = data ?? [];
        setSlips(rows);
        if (rows.length) {
          const { data: holds } = await sb
            .from("payroll_payment_holds")
            .select("detail_id, status")
            .in("detail_id", rows.map((slip) => slip.detail_id));
          setPaymentHolds(
            Object.fromEntries(
              ((holds ?? []) as { detail_id: string; status: PaymentHoldStatus }[]).map((hold) => [
                hold.detail_id,
                hold.status,
              ]),
            ),
          );
        } else setPaymentHolds({});
        setLoading(false);
      });
  }, [rider]);

  const busy = riderLoading || loading;

  return (
    <RiderLayout title={t("slip.title")}>
      <EarningsChecker riderId={rider?.id ?? ""} riderReady={!riderLoading && !!rider} riderName={rider?.full_name ?? ""} employeeId={rider?.employee_id ?? ""} />
      {busy ? (
        <div className="flex justify-center py-10">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : slips.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-primary/30 bg-primary-soft/35 p-8 text-center shadow-sm">
          <div className="text-sm font-medium">{t("slip.empty")}</div>
          <p className="text-xs text-muted-foreground mt-1">{t("slip.emptyDesc")}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {slips.map((s, index) => (
            <button
              key={s.id}
              onClick={() => {
                setOpenSlip(s);
                posthog.capture("payslip_viewed", {
                  run_name: s.payroll_runs?.name ?? null,
                  net_pay: s.data?.net_pay ?? null,
                });
              }}
              className={`rider-enter relative overflow-hidden flex items-center justify-between gap-3 rounded-2xl border px-4 py-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md ${index === 0 ? "border-primary/25 bg-gradient-to-br from-primary-soft via-card to-card dark:from-primary/15 dark:via-card dark:to-card" : "border-border bg-card hover:bg-primary-soft/30 dark:bg-card/90"}`}
              style={{ animationDelay: `${Math.min(index, 5) * 45}ms` }}
            >
              <span className="absolute inset-y-0 left-0 w-1 bg-primary opacity-0 transition-opacity group-hover:opacity-100" />
              <div className="min-w-0 flex-1 pr-1">
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary mb-1">
                  {index === 0 ? "Payslip terbaru" : "Payslip"}
                </div>
                <div className="text-sm font-semibold leading-snug line-clamp-2 break-words">
                  {s.payroll_runs?.name ?? "Payroll"}
                </div>
                <div className="text-[11px] leading-relaxed text-muted-foreground mt-1 line-clamp-2 break-words">
                  {s.payroll_runs ? `${formatTanggal(s.payroll_runs.period_start)} – ${formatTanggal(s.payroll_runs.period_end)}` : ""}
                  {s.data?.delivery_count != null && ` · ${s.data.delivery_count} order`}
                </div>
                {paymentHolds[s.detail_id] === "held" && (
                  <span className="mt-2 inline-flex rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-semibold text-warning">
                    Pembayaran ditahan
                  </span>
                )}
                {paymentHolds[s.detail_id] === "released" && (
                  <span className="mt-2 inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                    Pembayaran susulan diproses
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0 self-center">
                <div className="text-right"><span className="block text-[9px] font-semibold tracking-wider text-success uppercase mb-1">Published</span><span className="text-sm font-bold text-primary whitespace-nowrap">{formatRupiah(s.data?.net_pay)}</span></div>
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </div>
            </button>
          ))}
        </div>
      )}
      {openSlip && (
        <PayslipDetailModal
          slip={openSlip}
          riderId={rider?.id ?? ""}
          riderName={rider?.full_name ?? ""}
          employeeId={rider?.employee_id ?? ""}
          onClose={() => setOpenSlip(null)}
        />
      )}
    </RiderLayout>
  );
}

function PayslipDetailModal({
  slip,
  riderId,
  riderName,
  employeeId,
  onClose,
}: {
  slip: PayslipRow;
  riderId: string;
  riderName: string;
  employeeId: string;
  onClose: () => void;
}) {
  const { t } = useT();
  const [ded, setDed] = useState<{ name: string; amount: number }[]>([]);
  const [inc, setInc] = useState<{ name: string; amount: number }[]>([]);
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [loadingDed, setLoadingDed] = useState(true);
  const [loadingInc, setLoadingInc] = useState(true);
  const [dedError, setDedError] = useState<string | null>(null);
  const [incError, setIncError] = useState<string | null>(null);
  const [loadingClients, setLoadingClients] = useState(true);
  const [showPrint, setShowPrint] = useState(false);

  useEffect(() => {
    sb.from("payroll_deductions")
      .select("amount, description, deduction_types(name)")
      .eq("detail_id", slip.detail_id)
      .then(
        ({
          data,
          error,
        }: {
          data:
            | {
                amount: number;
                description: string | null;
                deduction_types: { name: string } | null;
              }[]
            | null;
          error: { message: string } | null;
        }) => {
          if (error) {
            console.error("[rider-payslip] gagal memuat potongan:", error.message);
            setDedError("Rincian potongan belum bisa dimuat. Coba lagi sebentar.");
          }
          setDed(
            (data ?? []).map((d) => {
              const type = d.deduction_types?.name ?? "Potongan";
              return {
                name: d.description ? `${type} — ${d.description}` : type,
                amount: Number(d.amount),
              };
            }),
          );
          setLoadingDed(false);
        },
      );

    sb.from("payroll_incentives")
      .select("amount, description")
      .eq("detail_id", slip.detail_id)
      .then(
        ({
          data,
          error,
        }: {
          data: { amount: number; description: string | null }[] | null;
          error: { message: string } | null;
        }) => {
          if (error) {
            console.error("[rider-payslip] gagal memuat insentif:", error.message);
            setIncError("Rincian insentif belum bisa dimuat. Coba lagi sebentar.");
          }
          setInc(
            (data ?? []).map((d) => ({
              name: d.description ?? "Insentif",
              amount: Number(d.amount),
            })),
          );
          setLoadingInc(false);
        },
      );

    sb.from("payroll_details")
      .select("id, client_id, delivery_count, gross_earning, clients(name)")
      .eq("run_id", slip.run_id)
      .eq("rider_id", riderId)
      .then(
        ({
          data,
        }: {
          data:
            | {
                id: string;
                client_id: string;
                delivery_count: number;
                gross_earning: number;
                clients: { name: string } | null;
              }[]
            | null;
        }) => {
          setClients(
            (data ?? []).map((d) => ({
              detail_id: d.id,
              client_id: d.client_id,
              client_name: d.clients?.name ?? "Client",
              delivery_count: d.delivery_count,
              gross_earning: Number(d.gross_earning),
            })),
          );
          setLoadingClients(false);
        },
      );
  }, [slip.detail_id, slip.run_id, riderId]);

  const period = slip.payroll_runs;

  return (
    <div
      className="fixed inset-0 bg-[#080611]/70 backdrop-blur-sm grid place-items-end sm:place-items-center z-50"
      onClick={onClose}
    >
      <div
        className="relative bg-card rounded-t-[1.75rem] sm:rounded-3xl w-full sm:max-w-sm max-h-[88vh] overflow-auto border border-white/10 shadow-2xl dark:bg-[#16132a]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="relative flex items-center justify-between gap-3 px-5 py-4 border-b border-border sticky top-0 bg-card/95 backdrop-blur-xl z-10 dark:bg-[#16132a]/95">
          <div className="absolute top-2 left-1/2 -translate-x-1/2 h-1 w-9 rounded-full bg-border sm:hidden" />
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">{period?.name ?? "Payroll"}</div>
            <div className="text-[11px] text-muted-foreground truncate">
              {riderName} · {employeeId}
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => setShowPrint(true)}
              disabled={loadingClients || loadingDed || loadingInc}
              className="p-2 rounded-xl text-muted-foreground hover:bg-primary-soft hover:text-primary disabled:opacity-40 transition-colors"
              title={t("btn.downloadPdf")}
            >
              <Download className="w-4 h-4" />
            </button>
            <button onClick={onClose} className="p-2 rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-5 space-y-5 text-sm">
          {/* summary */}
          <div className="relative overflow-hidden rounded-2xl border border-primary/25 bg-gradient-to-br from-primary via-violet-600 to-[#4c1d95] p-5 text-primary-foreground shadow-lg shadow-primary/20">
            <div className="absolute -right-10 -top-14 h-40 w-40 rounded-full bg-white/15 blur-2xl" />
            <div className="relative">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary-foreground/70">
                {t("slip.takeHome")}
              </p>
              <div className="mt-2 text-3xl font-bold tracking-tight">
                {formatRupiah(slip.data?.net_pay)}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 border-t border-white/20 pt-3 text-xs">
                <div><span className="block text-primary-foreground/65">{t("slip.ordersCompleted")}</span><b>{slip.data?.delivery_count ?? 0}</b></div>
                <div><span className="block text-primary-foreground/65">{t("slip.grossFee")}</span><b>{formatRupiah(slip.data?.gross_earning)}</b></div>
              </div>
              <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-semibold text-primary-foreground"><span className="w-1.5 h-1.5 rounded-full bg-success" /> Slip telah dipublikasikan</div>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card/60 p-3 dark:bg-white/[0.035]">
            <p className="mb-3 text-[10px] font-semibold tracking-[.14em] uppercase text-primary">Ringkasan perhitungan</p>
            <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-2 text-center"><div><span className="block text-[10px] text-muted-foreground">Gross</span><b className="block mt-1 text-[11px]">{formatRupiah(slip.data?.gross_earning)}</b></div><span className="text-primary/60">−</span><div><span className="block text-[10px] text-muted-foreground">Potongan</span><b className="block mt-1 text-[11px] text-warning">{formatRupiah(slip.data?.total_deduction)}</b></div><span className="text-primary/60">=</span><div><span className="block text-[10px] text-muted-foreground">Bersih</span><b className="block mt-1 text-[11px] text-primary">{formatRupiah(slip.data?.net_pay)}</b></div></div>
          </div>

          {/* per-client detail */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary mb-2">
              {t("slip.perClient")}
            </p>
            {loadingClients ? (
              <div className="flex justify-center py-3">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            ) : clients.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("slip.noClientData")}</p>
            ) : (
              <div className="space-y-2">
                {clients.map((c) => (
                  <ClientCard
                    key={c.client_id}
                    client={c}
                    riderId={riderId}
                    periodStart={period?.period_start ?? ""}
                    periodEnd={period?.period_end ?? ""}
                  />
                ))}
              </div>
            )}
          </div>

          {/* incentives */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary mb-2">
              {t("slip.incentives")}
            </p>
            <div className="rounded-2xl border border-border bg-card/60 p-3 dark:bg-white/[0.035]">
              {incError ? (
                <p className="text-xs text-destructive py-1">{incError}</p>
              ) : loadingInc ? (
                <div className="flex justify-center py-3">
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                </div>
              ) : inc.length === 0 ? (
                <p className="text-xs text-muted-foreground py-1">{t("slip.noIncentives")}</p>
              ) : (
                inc.map((d, i) => (
                  <Row key={i} label={d.name} value={`+${formatRupiah(d.amount)}`} positive />
                ))
              )}
            </div>
          </div>

          {/* deductions */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary mb-2">
              {t("slip.deductions")}
            </p>
            <div className="rounded-2xl border border-border bg-card/60 p-3 dark:bg-white/[0.035]">
              {dedError ? (
                <p className="text-xs text-destructive py-1">{dedError}</p>
              ) : loadingDed ? (
                <div className="flex justify-center py-3">
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                </div>
              ) : ded.length === 0 ? (
                <p className="text-xs text-muted-foreground py-1">{t("slip.noDeductions")}</p>
              ) : (
                ded.map((d, i) => (
                  <Row key={i} label={d.name} value={`−${formatRupiah(d.amount)}`} muted />
                ))
              )}
            </div>
          </div>

          {/* take-home */}
          <div className="rounded-2xl border border-primary/25 bg-primary-soft/45 px-4 py-3 flex items-baseline justify-between gap-3 dark:bg-primary/15">
            <span className="text-xs text-muted-foreground flex-shrink-0">
              {t("slip.takeHome")}
            </span>
            <span className="text-xl font-bold text-primary whitespace-nowrap">
              {formatRupiah(slip.data?.net_pay)}
            </span>
          </div>
        </div>
      </div>

      {showPrint && (
        <PayslipPrint
          slip={slip}
          riderName={riderName}
          employeeId={employeeId}
          clients={clients}
          incentives={inc}
          deductions={ded}
          onClose={() => setShowPrint(false)}
        />
      )}
    </div>
  );
}

function ClientCard({
  client,
  riderId,
  periodStart,
  periodEnd,
}: {
  client: ClientSummary;
  riderId: string;
  periodStart: string;
  periodEnd: string;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [deliveries, setDeliveries] = useState<DeliveryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);

  function toggle() {
    setOpen((v) => !v);
    if (!fetched) {
      setLoading(true);
      sb.from("delivery_records")
        .select(
          "id, delivery_date, awb, dash_delivery_id, delivery_type, service_type, distance_km, weight_kg, district, receiver_name, destination_address, fee, status",
        )
        .eq("rider_id", riderId)
        .eq("client_id", client.client_id)
        .gte("delivery_date", periodStart)
        .lte("delivery_date", periodEnd)
        .order("delivery_date", { ascending: false })
        .limit(20)
        .then(({ data }: { data: DeliveryRow[] | null }) => {
          setDeliveries(data ?? []);
          setLoading(false);
          setFetched(true);
        });
    }
  }

  const initials = client.client_name.slice(0, 3).toUpperCase();

  return (
    <div className="rounded-2xl border border-border bg-muted/30 overflow-hidden transition-colors hover:border-primary/35 dark:bg-white/[0.025]">
      <button
        onClick={toggle}
        className="w-full flex items-center gap-3 px-3.5 py-3 text-left hover:bg-primary-soft/35 transition-colors"
      >
        <span className="w-9 h-9 rounded-xl bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center flex-shrink-0">
          {initials}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold truncate">{client.client_name}</div>
          <div className="text-[11px] text-muted-foreground">{client.delivery_count} order</div>
        </div>
        <div className="text-right flex-shrink-0 mr-1">
          <div className="text-xs font-semibold">{formatRupiah(client.gross_earning)}</div>
        </div>
        {open ? (
          <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        )}
      </button>

      {open && (
        <div className="border-t border-border">
          {loading ? (
            <div className="flex justify-center py-3">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          ) : deliveries.length === 0 ? (
            <p className="text-xs text-muted-foreground px-3 py-2">{t("slip.noOrderData")}</p>
          ) : (
            <>
              {(() => {
                // Skema "1 alamat unik/hari" (lihat pricing-calc.ts) bikin
                // order ke-2+ ke alamat sama di hari yang sama jadi Rp0 —
                // tanpa catatan ini keliatan kayak error/ke-skip ke rider,
                // padahal emang sengaja gak dobel dihitung.
                const addrDayCount = new Map<string, number>();
                for (const d of deliveries) {
                  const key = `${d.delivery_date}|${(d.destination_address ?? "").trim().toLowerCase()}`;
                  addrDayCount.set(key, (addrDayCount.get(key) ?? 0) + 1);
                }
                return deliveries.map((d) => {
                  const orderId = d.awb ?? d.dash_delivery_id ?? d.id.slice(0, 8).toUpperCase();
                  const meta = [
                    d.service_type ?? d.delivery_type,
                    d.distance_km != null && `${d.distance_km} km`,
                    d.weight_kg != null && `${d.weight_kg} kg`,
                  ]
                    .filter(Boolean)
                    .join(" · ");
                  const dest = d.district ?? d.receiver_name;
                  const addrKey = `${d.delivery_date}|${(d.destination_address ?? "").trim().toLowerCase()}`;
                  const isDupZero =
                    d.fee === 0 &&
                    d.status?.toUpperCase() === "COMPLETED" &&
                    d.destination_address &&
                    (addrDayCount.get(addrKey) ?? 0) > 1;
                  return (
                    <div key={d.id} className="px-3 py-2.5 border-b border-border last:border-0">
                      <div className="flex items-start gap-3">
                        <div className="w-8 text-center flex-shrink-0 pt-0.5">
                          <div className="text-sm font-bold leading-none">
                            {new Date(d.delivery_date).getDate()}
                          </div>
                          <div className="text-[9px] text-muted-foreground uppercase">
                            {new Date(d.delivery_date).toLocaleString("id", { month: "short" })}
                          </div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-mono text-muted-foreground truncate">
                              {orderId}
                            </span>
                            <span className="text-xs font-semibold flex-shrink-0">
                              {formatRupiah(d.fee)}
                            </span>
                          </div>
                          <div className="text-[11px] text-foreground/80 mt-0.5 truncate">
                            {meta || "—"}
                          </div>
                          {dest && (
                            <div className="text-[10px] text-muted-foreground truncate mt-0.5">
                              {dest}
                            </div>
                          )}
                          {d.status && (
                            <div className="text-[9px] font-semibold uppercase tracking-wide mt-1 text-muted-foreground">
                              {d.status}
                            </div>
                          )}
                          {isDupZero && (
                            <div className="text-[10px] text-muted-foreground italic mt-1">
                              {t("slip.dupAddressNote")}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                });
              })()}
              {deliveries.length === 20 && client.delivery_count > 20 && (
                <p className="text-[11px] text-muted-foreground text-center px-3 py-2">
                  Menampilkan 20 dari {client.delivery_count} order
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  muted,
  positive,
}: {
  label: string;
  value: string;
  muted?: boolean;
  positive?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 border-b border-border/60 last:border-0">
      <span className="text-xs text-muted-foreground min-w-0 break-words">{label}</span>
      <span
        className={`text-xs flex-shrink-0 whitespace-nowrap ${positive ? "text-success" : muted ? "text-warning" : "text-foreground"}`}
      >
        {value}
      </span>
    </div>
  );
}
