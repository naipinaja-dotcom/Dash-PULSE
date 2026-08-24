import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AdminLayout } from "@/components/admin-layout";
import { Plus, Pencil, Trash2, Tag, Truck, Banknote, ChevronRight } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import {
  listPricingSchemes,
  deletePricingScheme,
  listClients,
  type MockClient,
} from "@/lib/pricing-store";
import type { PricingScheme } from "@/lib/pricing-types";
import { pricingLabel } from "@/lib/pricing-types";
import { describeScheme } from "@/lib/rate-card";
import { formatTanggal } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { toast } from "sonner";
import { confirmDialog } from "@/components/confirm-dialog";
import { ClientCombobox } from "@/components/client-combobox";
import { BulkActionBar } from "@/components/bulk-action-bar";
import { useBulkSelect } from "@/hooks/use-bulk-select";
import { PageSizeSelect, PaginationBar } from "@/components/pagination-bar";
import { usePagination } from "@/lib/use-pagination";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/admin/pricing/")({
  component: PricingListPage,
});

function PricingListPage() {
  const { t } = useT();
  const navigate = useNavigate();
  const [schemes, setSchemes] = useState<PricingScheme[]>([]);
  const [clients, setClients] = useState<MockClient[]>([]);
  const [filterClient, setFilterClient] = useState<string>("all");
  const [toDelete, setToDelete] = useState<PricingScheme | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  // Baris tabel dikelompokkan per client: skema Rider (cost) tampil sebagai
  // baris utama, skema Client (billing) & rider tambahan disembunyikan sampai
  // baris ini diklik — jadi tabel gak keliatan dobel per client secara default.
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const toggleGroup = (key: string) =>
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const refresh = () => {
    listPricingSchemes().then(setSchemes);
    listClients().then(setClients);
  };
  useEffect(refresh, []);

  const filtered = schemes.filter(
    (s) => filterClient === "all" || (s.client_id ?? "all-clients") === filterClient,
  );

  // Ringkasan gabungan Rider Pricing (cost) + Revenue Pricing — cuma muncul
  // kalau 1 client spesifik dipilih di filter (bukan "Semua Client" atau
  // "Berlaku Semua Client"), biar begitu klik client A langsung keliatan
  // dua-duanya bareng, gak perlu cross-reference baris tabel di bawah manual.
  const isSingleClient = filterClient !== "all" && filterClient !== "all-clients";
  const selectedClientName = isSingleClient
    ? (clients.find((c) => c.id === filterClient)?.name ?? "Client")
    : "";
  const riderSchemesForClient = filtered.filter((s) => s.scheme_for === "rider");
  const revenueSchemesForClient = filtered.filter((s) => s.scheme_for === "client");

  // Buat skema Revenue Share: cari skema Client (Per Pengiriman) yang match
  // client_id + category delivery + periode-nya overlap — sama persis logic
  // findClientScheme di RevenueShareCalc / admin.calculate.tsx, biar contoh
  // Rupiah di summary konsisten sama yang beneran dipakai pas Hitung Fee.
  const findLinkedClientScheme = (riderScheme: PricingScheme): PricingScheme | undefined => {
    const to_ = riderScheme.effective_to || riderScheme.effective_from;
    const candidates = revenueSchemesForClient.filter(
      (s) =>
        s.client_id === riderScheme.client_id &&
        s.category === "delivery" &&
        s.effective_from <= to_ &&
        (!s.effective_to || s.effective_to >= riderScheme.effective_from),
    );
    return candidates.sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))[0];
  };

  // Group baris tabel per client_id ("all" = skema "Berlaku Semua Client").
  // Group dengan >1 skema (biasanya pasangan Rider+Client utk client yang
  // sama) ditampilkan sebagai 1 baris ringkas, expand on click. Group dengan
  // cuma 1 skema tetap tampil flat seperti sebelumnya (gak ada gunanya di-collapse).
  const groupMap = new Map<string, { key: string; clientName: string; items: PricingScheme[] }>();
  for (const s of filtered) {
    const key = s.client_id ?? "all";
    let g = groupMap.get(key);
    if (!g) {
      g = { key, clientName: s.client_name ?? "Semua Client", items: [] };
      groupMap.set(key, g);
    }
    g.items.push(s);
  }
  const schemeGroups = [...groupMap.values()];
  const { pageSize, setPageSize, page, setPage, totalPages, paged, from, to, total } =
    usePagination(schemeGroups, 20);

  const bulk = useBulkSelect(filtered.map((s) => s.id));

  const handleBulkDelete = async () => {
    if (
      !(await confirmDialog({
        title: `Hapus ${bulk.count} skema?`,
        description: "Semua skema yang dicentang akan dihapus permanen.",
        confirmText: "Hapus",
      }))
    )
      return;
    setBulkDeleting(true);
    try {
      await Promise.all([...bulk.selected].map((id) => deletePricingScheme(id)));
      toast.success(`${bulk.count} skema dihapus`);
      bulk.clear();
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
    setBulkDeleting(false);
  };

  const renderSchemeRow = (
    s: PricingScheme,
    indented = false,
    expandable = false,
    isOpen = false,
    onToggle?: () => void,
  ) => (
    <tr
      key={s.id}
      className="border-b border-border last:border-b-0 hover:bg-muted/40 transition-colors"
    >
      <td className="px-4 py-3 w-8">
        <input
          type="checkbox"
          checked={bulk.selected.has(s.id)}
          onChange={() => bulk.toggle(s.id)}
          className="rounded border-border"
        />
      </td>
      <td
        className={"px-4 py-3 font-medium text-foreground" + (indented ? " pl-9" : "")}
        onClick={onToggle}
        role={onToggle ? "button" : undefined}
      >
        <div className="flex items-center gap-2">
          {expandable && (
            <ChevronRight
              className={`w-3.5 h-3.5 text-muted-foreground flex-shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`}
            />
          )}
          {s.name}
        </div>
      </td>
      <td className="px-4 py-3">
        <button
          type="button"
          onClick={() => {
            setFilterClient(s.client_id ?? "all-clients");
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
          className="text-muted-foreground hover:text-primary hover:underline transition-colors text-left"
        >
          {s.client_name ?? "Semua Client"}
        </button>
      </td>
      <td className="px-4 py-3">
        <span
          className={
            "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium " +
            (s.scheme_for === "client"
              ? "bg-violet-500/15 text-violet-600 dark:text-violet-300"
              : "bg-sky-500/15 text-sky-600 dark:text-sky-300")
          }
        >
          {s.scheme_for === "client" ? "Client" : "Rider"}
        </span>
      </td>
      <td className="px-4 py-3">
        <span className="inline-flex items-center rounded-md bg-primary text-primary-foreground border-2 border-border-strong px-2 py-0.5 text-[11px] font-medium">
          {pricingLabel(s.category, s.subtype)}
        </span>
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground">
        {formatTanggal(s.effective_from)}
        {s.effective_to ? ` – ${formatTanggal(s.effective_to)}` : " – tidak terbatas"}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1 justify-end">
          <Link
            to="/admin/pricing/$id"
            params={{ id: s.id }}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
            title="Edit"
          >
            <Pencil className="w-4 h-4" />
          </Link>
          <button
            onClick={() => setToDelete(s)}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-destructive"
            title="Hapus"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </td>
    </tr>
  );

  return (
    <AdminLayout title={t("pricing.title")} subtitle={t("pricing.subtitle")}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <label className="text-[11px] text-muted-foreground">Filter Client</label>
          <ClientCombobox
            value={filterClient}
            onChange={setFilterClient}
            options={[
              { value: "all", label: "Semua Client" },
              { value: "all-clients", label: "Berlaku Semua Client" },
              ...clients.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
        </div>
        <div className="flex items-center gap-2">
          {schemeGroups.length > 0 && (
            <PageSizeSelect pageSize={pageSize} setPageSize={setPageSize} />
          )}
          <Link
            to="/admin/pricing/new"
            className="inline-flex items-center gap-1.5 rounded-lg border-2 border-border-strong bg-primary text-primary-foreground px-3 py-1.5 text-[11px] font-bold shadow-[3px_3px_0_0_var(--color-border-strong)] hover:brightness-105 active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-[filter,transform,box-shadow]"
          >
            <Plus className="w-3.5 h-3.5" /> Tambah Skema
          </Link>
        </div>
      </div>

      {isSingleClient && (
        <div className="mb-5">
          <h2 className="text-sm font-semibold mb-2">Ringkasan Pricing — {selectedClientName}</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {/* Rider Pricing (cost) */}
            <div className="rounded-lg border border-border overflow-hidden">
              <div className="px-3 py-2 bg-sky-500/10 flex items-center gap-2">
                <Truck className="w-4 h-4 text-sky-600 dark:text-sky-300" />
                <span className="text-[13px] font-semibold">Rider Pricing (Cost)</span>
              </div>
              {riderSchemesForClient.length === 0 ? (
                <p className="p-3 text-xs text-muted-foreground">
                  Belum ada skema pembayaran rider untuk client ini.
                </p>
              ) : (
                riderSchemesForClient.map((s) => {
                  const rc = describeScheme(s, findLinkedClientScheme(s));
                  return (
                    <div key={s.id} className="border-t border-border first:border-t-0">
                      <div className="px-3 py-2 flex items-center gap-2 bg-muted/40">
                        <span className="text-[12px] font-medium truncate">{rc.schemeName}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary text-primary-foreground border-2 border-border-strong flex-shrink-0">
                          {rc.calcLabel}
                        </span>
                        <Link
                          to="/admin/pricing/$id"
                          params={{ id: s.id }}
                          className="ml-auto p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground flex-shrink-0"
                          title="Edit"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Link>
                      </div>
                      <table className="w-full text-xs">
                        <tbody>
                          {rc.sections.map((sec, si) => (
                            <Fragment key={si}>
                              {sec.title && (
                                <tr>
                                  <td
                                    colSpan={4}
                                    className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground bg-muted/20"
                                  >
                                    {sec.title}
                                  </td>
                                </tr>
                              )}
                              {sec.rows.map((r, ri) => (
                                <tr key={`${si}-${ri}`} className="border-t border-border/60">
                                  <td className="px-3 py-1.5">{r.variable}</td>
                                  <td className="px-2 py-1.5 text-right font-medium tabular-nums whitespace-nowrap">
                                    {r.rate}
                                  </td>
                                  <td className="px-2 py-1.5 text-muted-foreground whitespace-nowrap">
                                    {r.unit}
                                  </td>
                                  <td className="px-3 py-1.5 text-muted-foreground">{r.remarks}</td>
                                </tr>
                              ))}
                            </Fragment>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })
              )}
            </div>

            {/* Revenue Pricing (billing ke client) */}
            <div className="rounded-lg border border-border overflow-hidden">
              <div className="px-3 py-2 bg-violet-500/10 flex items-center gap-2">
                <Banknote className="w-4 h-4 text-violet-600 dark:text-violet-300" />
                <span className="text-[13px] font-semibold">Revenue Pricing (Billing Client)</span>
              </div>
              {revenueSchemesForClient.length === 0 ? (
                <p className="p-3 text-xs text-muted-foreground">
                  Belum ada skema tagihan ke client ini.
                </p>
              ) : (
                revenueSchemesForClient.map((s) => {
                  const rc = describeScheme(s);
                  return (
                    <div key={s.id} className="border-t border-border first:border-t-0">
                      <div className="px-3 py-2 flex items-center gap-2 bg-muted/40">
                        <span className="text-[12px] font-medium truncate">{rc.schemeName}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary text-primary-foreground border-2 border-border-strong flex-shrink-0">
                          {rc.calcLabel}
                        </span>
                        <Link
                          to="/admin/pricing/$id"
                          params={{ id: s.id }}
                          className="ml-auto p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground flex-shrink-0"
                          title="Edit"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Link>
                      </div>
                      <table className="w-full text-xs">
                        <tbody>
                          {rc.sections.map((sec, si) => (
                            <Fragment key={si}>
                              {sec.title && (
                                <tr>
                                  <td
                                    colSpan={4}
                                    className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground bg-muted/20"
                                  >
                                    {sec.title}
                                  </td>
                                </tr>
                              )}
                              {sec.rows.map((r, ri) => (
                                <tr key={`${si}-${ri}`} className="border-t border-border/60">
                                  <td className="px-3 py-1.5">{r.variable}</td>
                                  <td className="px-2 py-1.5 text-right font-medium tabular-nums whitespace-nowrap">
                                    {r.rate}
                                  </td>
                                  <td className="px-2 py-1.5 text-muted-foreground whitespace-nowrap">
                                    {r.unit}
                                  </td>
                                  <td className="px-3 py-1.5 text-muted-foreground">{r.remarks}</td>
                                </tr>
                              ))}
                            </Fragment>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      <div className="rounded-xl border-[3px] border-border-strong bg-card shadow-[6px_6px_0_0_var(--color-border-strong)] overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-10 text-center">
            <div className="w-12 h-12 rounded-full border-2 border-border-strong bg-card text-foreground grid place-items-center mx-auto mb-3">
              <Tag className="w-5 h-5" />
            </div>
            <div className="text-sm font-medium">Belum ada skema pricing</div>
            <p className="text-xs text-muted-foreground mt-1 mb-4">
              Buat skema baru untuk menentukan cara kalkulasi pendapatan rider.
            </p>
            <button
              onClick={() => navigate({ to: "/admin/pricing/new" })}
              className="inline-flex items-center gap-1.5 rounded-lg border-2 border-border-strong bg-primary text-primary-foreground px-3 py-2 text-sm font-bold shadow-[3px_3px_0_0_var(--color-border-strong)] hover:brightness-105 active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-[filter,transform,box-shadow]"
            >
              <Plus className="w-4 h-4" /> Tambah Skema
            </button>
          </div>
        ) : (
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-3 w-8">
                  <input
                    type="checkbox"
                    checked={bulk.allSelected}
                    onChange={bulk.toggleAll}
                    className="rounded border-border"
                  />
                </th>
                <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-4 py-3">
                  Nama Skema
                </th>
                <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-4 py-3">
                  Client
                </th>
                <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-4 py-3">
                  Untuk
                </th>
                <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-4 py-3">
                  Tipe
                </th>
                <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-4 py-3">
                  Berlaku
                </th>
                <th className="px-4 py-3 w-24" />
              </tr>
            </thead>
            <tbody>
              {paged.map((g) => {
                // Baris utama yang selalu keliatan = skema Rider (cost) —
                // skema Client (billing) & rider tambahan cuma nongol pas expand.
                const primary = g.items.find((i) => i.scheme_for === "rider") ?? g.items[0];
                const rest = g.items.filter((i) => i.id !== primary.id);
                const isOpen = expandedGroups.has(g.key);
                return (
                  <Fragment key={g.key}>
                    {renderSchemeRow(
                      primary,
                      false,
                      rest.length > 0,
                      isOpen,
                      rest.length > 0 ? () => toggleGroup(g.key) : undefined,
                    )}
                    {isOpen && rest.map((s) => renderSchemeRow(s, true))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {schemeGroups.length > 0 && (
        <PaginationBar
          page={page}
          totalPages={totalPages}
          setPage={setPage}
          from={from}
          to={to}
          total={total}
        />
      )}

      <BulkActionBar
        count={bulk.count}
        label="skema"
        deleting={bulkDeleting}
        onDelete={handleBulkDelete}
        onClear={bulk.clear}
      />

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus skema?</AlertDialogTitle>
            <AlertDialogDescription>
              Skema <strong>{toDelete?.name}</strong> akan dihapus permanen.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (toDelete) {
                  try {
                    await deletePricingScheme(toDelete.id);
                    toast.success("Skema dihapus");
                    refresh();
                  } catch (e) {
                    toast.error((e as Error).message);
                  }
                  setToDelete(null);
                }
              }}
            >
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
