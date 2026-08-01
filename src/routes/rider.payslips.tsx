import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { usePostHog } from "@posthog/react";
import { RiderLayout } from "@/components/rider-layout";
import { supabase } from "@/integrations/supabase/client";
import { useRiderSelf } from "@/lib/use-rider-self";
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
  fee: number;
  status: string | null;
};

function PayslipsPage() {
  const posthog = usePostHog();
  const { rider, loading: riderLoading } = useRiderSelf();
  const [slips, setSlips] = useState<PayslipRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [openSlip, setOpenSlip] = useState<PayslipRow | null>(null);

  useEffect(() => {
    if (!rider) { setLoading(false); return; }
    sb.from("payslips")
      .select("id, detail_id, run_id, published_at, data, payroll_runs(name, period_start, period_end)")
      .eq("rider_id", rider.id)
      .order("published_at", { ascending: false })
      .then(({ data }: { data: PayslipRow[] | null }) => {
        setSlips(data ?? []);
        setLoading(false);
      });
  }, [rider]);

  const busy = riderLoading || loading;

  return (
    <RiderLayout title="Slip Gaji">
      <EarningsChecker riderId={rider?.id ?? ""} riderReady={!riderLoading && !!rider} />
      {busy ? (
        <div className="flex justify-center py-10">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : slips.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card p-8 text-center">
          <div className="text-sm font-medium">Belum ada slip gaji</div>
          <p className="text-xs text-muted-foreground mt-1">
            Slip gaji akan muncul di sini setelah admin publish payroll.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {slips.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                setOpenSlip(s);
                posthog.capture("payslip_viewed", {
                  run_name: s.payroll_runs?.name ?? null,
                  net_pay: s.data?.net_pay ?? null,
                });
              }}
              className="w-full flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3.5 py-3 text-left hover:bg-muted/40"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{s.payroll_runs?.name ?? "Payroll"}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                  {s.payroll_runs
                    ? `${formatTanggal(s.payroll_runs.period_start)} – ${formatTanggal(s.payroll_runs.period_end)}`
                    : ""}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-sm font-semibold whitespace-nowrap">{formatRupiah(s.data?.net_pay)}</span>
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
  slip, riderId, riderName, employeeId, onClose,
}: {
  slip: PayslipRow;
  riderId: string;
  riderName: string;
  employeeId: string;
  onClose: () => void;
}) {
  const [ded, setDed] = useState<{ name: string; amount: number }[]>([]);
  const [inc, setInc] = useState<{ name: string; amount: number }[]>([]);
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [loadingDed, setLoadingDed] = useState(true);
  const [loadingInc, setLoadingInc] = useState(true);
  const [loadingClients, setLoadingClients] = useState(true);
  const [showPrint, setShowPrint] = useState(false);

  useEffect(() => {
    sb.from("payroll_deductions")
      .select("amount, description, deduction_types(name)")
      .eq("detail_id", slip.detail_id)
      .then(({ data }: { data: { amount: number; description: string | null; deduction_types: { name: string } | null }[] | null }) => {
        setDed((data ?? []).map((d) => {
          const type = d.deduction_types?.name ?? "Potongan";
          return { name: d.description ? `${type} — ${d.description}` : type, amount: Number(d.amount) };
        }));
        setLoadingDed(false);
      });

    sb.from("payroll_incentives")
      .select("amount, description")
      .eq("detail_id", slip.detail_id)
      .then(({ data }: { data: { amount: number; description: string | null }[] | null }) => {
        setInc((data ?? []).map((d) => ({ name: d.description ?? "Insentif", amount: Number(d.amount) })));
        setLoadingInc(false);
      });

    sb.from("payroll_details")
      .select("id, client_id, delivery_count, gross_earning, clients(name)")
      .eq("run_id", slip.run_id)
      .eq("rider_id", riderId)
      .then(({ data }: { data: { id: string; client_id: string; delivery_count: number; gross_earning: number; clients: { name: string } | null }[] | null }) => {
        setClients(
          (data ?? []).map((d) => ({
            detail_id: d.id,
            client_id: d.client_id,
            client_name: d.clients?.name ?? "Client",
            delivery_count: d.delivery_count,
            gross_earning: Number(d.gross_earning),
          }))
        );
        setLoadingClients(false);
      });
  }, [slip.detail_id, slip.run_id, riderId]);

  const period = slip.payroll_runs;

  return (
    <div className="fixed inset-0 bg-black/50 grid place-items-end sm:place-items-center z-50" onClick={onClose}>
      <div
        className="bg-card rounded-t-2xl sm:rounded-lg w-full sm:max-w-sm max-h-[85vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border sticky top-0 bg-card">
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">{period?.name ?? "Payroll"}</div>
            <div className="text-[11px] text-muted-foreground truncate">{riderName} · {employeeId}</div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => setShowPrint(true)}
              disabled={loadingClients || loadingDed || loadingInc}
              className="p-1.5 text-muted-foreground hover:text-primary disabled:opacity-40"
              title="Unduh PDF"
            >
              <Download className="w-4 h-4" />
            </button>
            <button onClick={onClose} className="p-1.5 text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-4 space-y-4 text-sm">
          {/* summary */}
          <div>
            <Row label="Order selesai" value={String(slip.data?.delivery_count ?? 0)} />
            <Row label="Fee kotor" value={formatRupiah(slip.data?.gross_earning)} />
          </div>

          {/* per-client detail */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
              Detail per Client
            </p>
            {loadingClients ? (
              <div className="flex justify-center py-3">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            ) : clients.length === 0 ? (
              <p className="text-xs text-muted-foreground">Tidak ada data client.</p>
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
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
              Insentif Tambahan
            </p>
            <div className="border-t border-border pt-2">
              {loadingInc ? (
                <div className="flex justify-center py-3">
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                </div>
              ) : inc.length === 0 ? (
                <p className="text-xs text-muted-foreground py-1">Tidak ada insentif tambahan periode ini.</p>
              ) : (
                inc.map((d, i) => (
                  <Row key={i} label={d.name} value={`+${formatRupiah(d.amount)}`} positive />
                ))
              )}
            </div>
          </div>

          {/* deductions */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
              Potongan
            </p>
            <div className="border-t border-border pt-2">
              {loadingDed ? (
                <div className="flex justify-center py-3">
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                </div>
              ) : ded.length === 0 ? (
                <p className="text-xs text-muted-foreground py-1">Tidak ada potongan periode ini.</p>
              ) : (
                ded.map((d, i) => (
                  <Row key={i} label={d.name} value={`−${formatRupiah(d.amount)}`} muted />
                ))
              )}
            </div>
          </div>

          {/* take-home */}
          <div className="border-t border-border pt-1 flex items-baseline justify-between gap-3">
            <span className="text-xs text-muted-foreground flex-shrink-0">Take-home</span>
            <span className="text-xl font-semibold text-primary whitespace-nowrap">{formatRupiah(slip.data?.net_pay)}</span>
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
  client, riderId, periodStart, periodEnd,
}: {
  client: ClientSummary;
  riderId: string;
  periodStart: string;
  periodEnd: string;
}) {
  const [open, setOpen] = useState(false);
  const [deliveries, setDeliveries] = useState<DeliveryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);

  function toggle() {
    setOpen((v) => !v);
    if (!fetched) {
      setLoading(true);
      sb.from("delivery_records")
        .select("id, delivery_date, awb, dash_delivery_id, delivery_type, service_type, distance_km, weight_kg, district, receiver_name, fee, status")
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
    <div className="rounded-lg border border-border bg-muted/30 overflow-hidden">
      <button
        onClick={toggle}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/50"
      >
        <span className="w-8 h-8 rounded-md bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center flex-shrink-0">
          {initials}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold truncate">{client.client_name}</div>
          <div className="text-[11px] text-muted-foreground">{client.delivery_count} order</div>
        </div>
        <div className="text-right flex-shrink-0 mr-1">
          <div className="text-xs font-semibold">{formatRupiah(client.gross_earning)}</div>
        </div>
        {open
          ? <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          : <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        }
      </button>

      {open && (
        <div className="border-t border-border">
          {loading ? (
            <div className="flex justify-center py-3">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          ) : deliveries.length === 0 ? (
            <p className="text-xs text-muted-foreground px-3 py-2">Tidak ada data order.</p>
          ) : (
            <>
              {deliveries.map((d) => {
                const orderId = d.awb ?? d.dash_delivery_id ?? d.id.slice(0, 8).toUpperCase();
                const meta = [
                  d.service_type ?? d.delivery_type,
                  d.distance_km != null && `${d.distance_km} km`,
                  d.weight_kg != null && `${d.weight_kg} kg`,
                ].filter(Boolean).join(" · ");
                const dest = d.district ?? d.receiver_name;
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
                          <span className="text-[11px] font-mono text-muted-foreground truncate">{orderId}</span>
                          <span className="text-xs font-semibold flex-shrink-0">{formatRupiah(d.fee)}</span>
                        </div>
                        <div className="text-[11px] text-foreground/80 mt-0.5 truncate">{meta || "—"}</div>
                        {dest && (
                          <div className="text-[10px] text-muted-foreground truncate mt-0.5">{dest}</div>
                        )}
                        {d.status && (
                          <div className="text-[9px] font-semibold uppercase tracking-wide mt-1 text-muted-foreground">
                            {d.status}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
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

function Row({ label, value, muted, positive }: { label: string; value: string; muted?: boolean; positive?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <span className="text-xs text-muted-foreground min-w-0 break-words">{label}</span>
      <span className={`text-xs flex-shrink-0 whitespace-nowrap ${positive ? "text-success" : muted ? "text-warning" : "text-foreground"}`}>{value}</span>
    </div>
  );
}
