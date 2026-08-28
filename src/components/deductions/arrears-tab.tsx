import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageSizeSelect, PaginationBar } from "@/components/pagination-bar";
import { usePagination } from "@/lib/use-pagination";
import { toast } from "sonner";
import { Loader2, Pencil, ExternalLink } from "lucide-react";
import { useT } from "@/lib/i18n";
import { fixedRemaining, latestRentalUnpaid, type RentalUnpaid } from "@/lib/arrears";
import { useAuth } from "@/lib/auth";
import { formatRupiah, parseRupiah } from "@/lib/format";
import type { Client, DType, Inst, Rider } from "./types";

type ArrearRow = {
  id: string;
  mode: Inst["mode"];
  rider?: Rider;
  type?: DType;
  client?: Client;
  info: string;
  progress?: { remaining: number; total: number; paid: number };
  amount: number;
  // Cuma keisi buat baris sewa (mode daily/monthly) — dedId nunjuk ke baris
  // payroll_deductions PERSIS sumber angka ini, dipakai buat koreksi manual
  // (master admin only, lihat RLS "pded update tunggakan gated").
  rental?: RentalUnpaid;
};

// Rumus tunggakannya ada di src/lib/arrears.ts (satu tempat, dipakai juga di
// admin.dashboard.tsx & rider.dashboard.tsx) — sama kayak getCarriedArrears()
// di payroll-generate.ts, di sini cuma buat dibaca & ditampilin, gak nyentuh
// perhitungan/publish payroll sama sekali.
export function ArrearsTab({ onGoToActiveTab }: { onGoToActiveTab?: () => void }) {
  const { t } = useT();
  const { user } = useAuth();
  const [rows, setRows] = useState<ArrearRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState(0);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    // SENGAJA gak filter .eq("active", true) — cicilan sewa yang dinonaktifkan
    // (lihat deactivate() di active-tab.tsx) masih bisa punya sisa tunggakan
    // yang belum lunas, dan itu harus TETAP kebaca di sini. Baris yang udah
    // beres (amount 0) otomatis kefilter di bawah, gak perlu filter active.
    const { data: installments, error } = await (supabase as any)
      .from("rider_installments")
      .select(
        "id, mode, installment_count, installments_paid, per_period_amount, riders(id, employee_id, full_name), deduction_types(id, code, name), clients(id, name)",
      );
    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }

    const fixedRows: ArrearRow[] = (installments ?? [])
      .filter((r: any) => r.mode === "fixed")
      .map((r: any) => {
        const { remaining, amount } = fixedRemaining(r.installment_count, r.installments_paid, r.per_period_amount);
        return {
          id: r.id,
          mode: r.mode,
          rider: r.riders,
          type: r.deduction_types,
          client: r.clients,
          info: `${remaining}/${r.installment_count ?? 0} ${t("dedarrears.installments")}`,
          progress: {
            remaining,
            total: r.installment_count ?? 0,
            paid: Math.max(0, Number(r.installments_paid ?? 0)),
          },
          amount,
        };
      })
      .filter((r: ArrearRow) => r.amount > 0);

    const rentalRows = (installments ?? []).filter((r: any) => r.mode === "daily" || r.mode === "monthly");
    let rentalArrears: ArrearRow[] = [];
    if (rentalRows.length > 0) {
      const latestUnpaid = await latestRentalUnpaid(rentalRows.map((r: any) => r.id));
      rentalArrears = rentalRows
        .map((r: any) => ({
          id: r.id,
          mode: r.mode,
          rider: r.riders,
          type: r.deduction_types,
          client: r.clients,
          info: r.mode === "monthly" ? t("dedarrears.monthlyRental") : t("dedarrears.dailyRental"),
          amount: latestUnpaid.get(r.id)?.unpaid ?? 0,
          rental: latestUnpaid.get(r.id),
        }))
        .filter((r: ArrearRow) => r.amount > 0);
    }

    setRows([...fixedRows, ...rentalArrears].sort((a, b) => b.amount - a.amount));
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  // Koreksi tunggakan sewa (mode daily/monthly) — master admin only, di-enforce
  // di RLS ("pded update tunggakan gated"), UI cuma nyembunyiin biar gak
  // ketemu error. Admin masukin nominal tunggakan yang BENER, kita balik hitung
  // paid_amount-nya (amount - tunggakanBaru) langsung ke baris payroll_deductions
  // sumber angka ini (r.rental.dedId) — bukan bikin baris/angka baru.
  const saveArrearsEdit = async (r: ArrearRow) => {
    if (!r.rental) return;
    if (editAmount < 0 || editAmount > r.rental.amount) {
      return toast.error(
        `Nominal harus antara Rp0 dan Rp${r.rental.amount.toLocaleString("id-ID")} (total potongan periode itu).`,
      );
    }
    setSaving(true);
    const newPaidAmount = r.rental.amount - editAmount;
    const { error } = await (supabase as any)
      .from("payroll_deductions")
      .update({ paid_amount: newPaidAmount })
      .eq("id", r.rental.dedId);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(t("dedarrears.correctionSaved"));
    setEditingId(null);
    load();
  };

  const typeOptions = [...new Map(rows.filter((r) => r.type).map((r) => [r.type!.id, r.type!])).values()];
  const filtered = rows.filter((r) => {
    const q = search.trim().toLowerCase();
    const matchesSearch =
      !q || r.rider?.full_name.toLowerCase().includes(q) || r.rider?.employee_id.toLowerCase().includes(q);
    const matchesType = !typeFilter || r.type?.id === typeFilter;
    return matchesSearch && matchesType;
  });
  const totalAmount = filtered.reduce((s, r) => s + r.amount, 0);

  const { pageSize, setPageSize, page, setPage, totalPages, paged, from, to, total } = usePagination(filtered, 10);

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 mb-4 max-w-md">
        <div className="admin-kpi-card p-4" data-variant="danger">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            {t("dedarrears.ridersInArrears")}
          </div>
          <div className="admin-metric-value text-[22px] font-bold font-mono">{filtered.length}</div>
        </div>
        <div className="admin-kpi-card p-4" data-variant="danger">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            {t("dedarrears.totalArrears")}
          </div>
          <div className="admin-metric-value text-[22px] font-bold font-mono">
            Rp{totalAmount.toLocaleString("id-ID")}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          placeholder={t("dedarrears.searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-md border-2 border-border-strong bg-background px-3 py-1.5 text-sm w-56 outline-none focus:ring-1 focus:ring-ring"
        />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded-md border-2 border-border-strong bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="">{t("dedarrears.allTypes")}</option>
          {typeOptions.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      {!loading && filtered.length > 0 && (
        <div className="flex justify-end mb-2">
          <PageSizeSelect pageSize={pageSize} setPageSize={setPageSize} />
        </div>
      )}
      <div className="rounded-xl border-[3px] border-border-strong bg-card shadow-[6px_6px_0_0_var(--color-border-strong)] overflow-hidden">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-3">
                {t("dedarrears.colRider")}
              </th>
              <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-3">
                {t("dedarrears.colJenis")}
              </th>
              <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-3">
                {t("dedarrears.colInfo")}
              </th>
              <th className="text-right text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-3">
                {t("dedarrears.colTunggakan")}
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="p-8 text-center">
                  <Loader2 className="w-4 h-4 animate-spin inline text-primary" />
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={4} className="p-8 text-center text-muted-foreground text-[11px]">
                  {t("dedarrears.emptyState")}
                </td>
              </tr>
            ) : (
              paged.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-b-0 hover:bg-muted/40 transition-colors">
                  <td className="p-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground border-2 border-border-strong grid place-items-center text-[11px] font-semibold flex-shrink-0">
                        {(r.rider?.full_name ?? "R")
                          .split(" ")
                          .map((w) => w[0])
                          .filter(Boolean)
                          .slice(0, 2)
                          .join("")
                          .toUpperCase()}
                      </div>
                      <div>
                        <div className="font-semibold text-foreground">{r.rider?.full_name}</div>
                        <div
                          className="text-[10px] text-muted-foreground"
                          style={{ fontFamily: "'JetBrains Mono', monospace" }}
                        >
                          {r.rider?.employee_id}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {r.type?.name}
                    {r.client && <span className="block text-[10px] font-medium text-primary">{r.client.name}</span>}
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {r.progress ? (
                      <div className="leading-tight">
                        <div className="font-medium text-foreground">
                          {t("dedarrears.remainingLabel")} {r.progress.remaining} {t("dedarrears.ofLabel")} {r.progress.total} {t("dedarrears.installments")}
                        </div>
                        <div className="mt-1 text-[10px] text-muted-foreground">
                          {r.progress.paid > 0
                            ? `${t("dedarrears.paidLabel")}: ${t("dedarrears.installmentOrdinal")}1${r.progress.paid > 1 ? `–${r.progress.paid}` : ""}`
                            : t("dedarrears.nonePaidLabel")}
                        </div>
                        <div className="mt-0.5 text-[10px] font-medium text-destructive">
                          {t("dedarrears.dueLabel")}: {t("dedarrears.installmentOrdinal")}{r.progress.paid + 1}
                          {r.progress.remaining > 1 ? `–${r.progress.total}` : ""}
                          {" · "}{formatRupiah(r.amount)}
                        </div>
                      </div>
                    ) : (
                      r.info
                    )}
                  </td>
                  <td className="p-3 text-right">
                    {editingId === r.id ? (
                      <div className="flex items-center justify-end gap-1.5">
                        <input
                          autoFocus
                          inputMode="numeric"
                          value={editAmount ? editAmount.toLocaleString("id-ID") : ""}
                          onChange={(e) => setEditAmount(parseRupiah(e.target.value))}
                          className="w-28 rounded-md border-2 border-border-strong bg-background px-2 py-1 text-right text-[12px] tabular-nums outline-none focus:ring-1 focus:ring-ring"
                        />
                        <button
                          onClick={() => saveArrearsEdit(r)}
                          disabled={saving}
                          className="rounded-md bg-primary text-primary-foreground px-2 py-1 text-[11px] disabled:opacity-50"
                        >
                          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t("dedarrears.saveBtn")}
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="text-[11px] text-muted-foreground hover:text-foreground"
                        >
                          {t("dedarrears.cancelBtn")}
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-end gap-1.5">
                        <span className="font-bold text-destructive tabular-nums font-mono">
                          Rp{r.amount.toLocaleString("id-ID")}
                        </span>
                        {r.rental && user?.isMasterAdmin && (
                          <button
                            onClick={() => {
                              setEditingId(r.id);
                              setEditAmount(r.amount);
                            }}
                            title={t("dedarrears.editTooltip")}
                            className="text-muted-foreground hover:text-primary"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {!r.rental && onGoToActiveTab && (
                          <button
                            onClick={onGoToActiveTab}
                            title={t("dedarrears.editInActiveTabTooltip")}
                            className="text-muted-foreground hover:text-primary"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {!loading && (
        <PaginationBar page={page} totalPages={totalPages} setPage={setPage} from={from} to={to} total={total} />
      )}
    </div>
  );
}
