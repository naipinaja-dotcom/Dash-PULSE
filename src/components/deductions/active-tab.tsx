import { Fragment, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageSizeSelect, PaginationBar } from "@/components/pagination-bar";
import { usePagination } from "@/lib/use-pagination";
import { parseRupiah } from "@/lib/format";
import { confirmDialog } from "@/components/confirm-dialog";
import { BulkActionBar } from "@/components/bulk-action-bar";
import { useBulkSelect } from "@/hooks/use-bulk-select";
import { toast } from "sonner";
import { Loader2, Trash2, Pencil } from "lucide-react";
import { ClientCombobox } from "@/components/client-combobox";
import type { Client, DType, Inst, Rider } from "./types";

export function ActiveTab() {
  const [rows, setRows] = useState<(Inst & { rider?: Rider; type?: DType; client?: Client })[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [types, setTypes] = useState<DType[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [recipients, setRecipients] = useState<{ id: string; name: string; bank_name: string; account_number: string }[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [ef, setEf] = useState({
    deduction_type_id: "",
    mode: "fixed" as "fixed" | "daily" | "monthly",
    total_amount: 0,
    installment_count: 1,
    daily_rate: 0,
    cycle_start_day: 25,
    charge_target: "rider" as "rider" | "client_revenue",
    client_id: "",
    next_deduction_date: "",
    notes: "",
    kasbon_recipient_id: "",
  });
  const [saving, setSaving] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  const load = async () => {
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("rider_installments")
      .select(
        "*, riders(id, employee_id, full_name), deduction_types(id, code, name, description, installmentable, active), clients(id, name)",
      )
      .eq("active", true)
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    else
      setRows(
        (data ?? []).map((r: any) => ({ ...r, rider: r.riders, type: r.deduction_types, client: r.clients })),
      );
    setLoading(false);
  };
  useEffect(() => {
    load();
    // Filter sama persis dengan AddTab.save(): jenis apapun yang non-auto-recurring
    // bisa dipakai di sini (installmentable cuma ngatur boleh-tidaknya dicicil,
    // bukan syarat buat muncul di Cicilan Aktif — one-shot pun disimpan di tabel ini).
    (supabase as any)
      .from("deduction_types")
      .select("*")
      .eq("active", true)
      .eq("auto_recurring", false)
      .then(({ data }: any) => setTypes(data ?? []));
    (supabase as any)
      .from("clients")
      .select("id, name")
      .order("name")
      .then(({ data }: any) => setClients(data ?? []));
    (supabase as any).from("kasbon_recipients").select("id, name, bank_name, account_number").eq("active", true).order("name")
      .then(({ data }: any) => setRecipients(data ?? []));
  }, []);

  const startEdit = (r: Inst & { rider?: Rider; type?: DType; client?: Client }) => {
    setEditingId(r.id);
    setEf({
      deduction_type_id: r.deduction_type_id,
      mode: r.mode ?? "fixed",
      total_amount: r.total_amount ?? 0,
      installment_count: r.installment_count ?? 1,
      daily_rate: r.daily_rate ?? 0,
      cycle_start_day: r.cycle_start_day ?? 25,
      charge_target: r.charge_target ?? "rider",
      client_id: r.client_id ?? "",
      next_deduction_date: r.next_deduction_date ?? "",
      notes: r.notes ?? "",
      kasbon_recipient_id: (r as any).kasbon_recipient_id ?? "",
    });
  };

  // Koreksi jadwal cicilan yang salah input, TERMASUK ganti mode ('fixed'
  // cicilan <-> 'daily' sewa harian) kalau ternyata salah pilih pas bikin.
  // mode='fixed': per_period_amount dihitung ulang dari total_amount/
  // installment_count (rumus sama persis dengan waktu bikin cicilan baru,
  // AddTab.save). mode='daily': cuma daily_rate yang relevan, installment_count
  // & installments_paid direset ke 0 karena gak ada konsep "lunas" di mode ini.
  // TIDAK menyentuh riwayat payroll_deductions yang sudah tercatat — cuma
  // proyeksi ke depan (potongan otomatis di run berikutnya).
  const saveEdit = async (r: Inst) => {
    if (!ef.deduction_type_id) return toast.error("Lengkapi jenis potongan");
    if (ef.mode !== r.mode && r.installments_paid > 0) {
      return toast.error(
        `Mode gak bisa diganti — cicilan ini udah kepotong ${r.installments_paid}× di mode lama.`,
      );
    }
    setSaving(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const update: any = {
      deduction_type_id: ef.deduction_type_id,
      mode: ef.mode,
      client_id: ef.client_id || null,
      next_deduction_date: ef.next_deduction_date || null,
      notes: ef.notes || null,
      kasbon_recipient_id: r.type?.code === "KASBON" ? (ef as any).kasbon_recipient_id || null : null,
    };
    if (ef.mode === "daily") {
      update.daily_rate = ef.daily_rate;
      update.charge_target = ef.charge_target;
      update.cycle_start_day = null;
      update.total_amount = null;
      update.installment_count = null;
      update.per_period_amount = null;
    } else if (ef.mode === "monthly") {
      update.daily_rate = ef.daily_rate;
      update.cycle_start_day = ef.cycle_start_day;
      update.charge_target = ef.charge_target;
      update.total_amount = null;
      update.installment_count = null;
      update.per_period_amount = null;
    } else {
      if (ef.installment_count < r.installments_paid) {
        setSaving(false);
        return toast.error(
          `Jumlah cicilan gak boleh kurang dari yang sudah terbayar (${r.installments_paid}).`,
        );
      }
      // per_period_amount buat cicilan SISA (bukan total_amount baru dibagi
      // rata ke SEMUA cicilan) — kalau udah ada yang kebayar di rate LAMA,
      // bagi rata ulang bikin total akhir yang beneran ketagih meleset dari
      // total_amount yang diminta (sisa yang udah lunas gak ke-reconcile).
      const alreadyPaid = r.installments_paid * (r.per_period_amount ?? 0);
      const remainingCount = ef.installment_count - r.installments_paid;
      const remainingAmount = ef.total_amount - alreadyPaid;
      if (remainingCount === 0) {
        if (remainingAmount > 0.5) {
          setSaving(false);
          return toast.error(
            `Total baru gak konsisten — ${r.installments_paid}× udah lunas (Rp${alreadyPaid.toLocaleString("id-ID")}) tapi total barunya lebih tinggi dan gak nyisain cicilan lagi buat nutup selisihnya. Naikin jumlah cicilan atau turunin total.`,
          );
        }
        update.per_period_amount = 0;
      } else {
        update.per_period_amount = +(Math.max(0, remainingAmount) / remainingCount).toFixed(2);
      }
      update.total_amount = ef.total_amount;
      update.installment_count = ef.installment_count;
      update.daily_rate = null;
      update.cycle_start_day = null;
      update.charge_target = "rider";
    }
    const { error } = await supabase.from("rider_installments").update(update).eq("id", r.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(
      "Cicilan diperbarui — perubahan ini cuma berlaku ke potongan berikutnya, riwayat yang sudah tercatat tidak berubah.",
    );
    setEditingId(null);
    load();
  };

  const typeOptions = [...new Map(rows.filter((r) => r.type).map((r) => [r.type!.id, r.type!])).values()];
  const filteredRows = rows.filter((r) => {
    const q = search.trim().toLowerCase();
    const matchesSearch =
      !q ||
      r.rider?.full_name.toLowerCase().includes(q) ||
      r.rider?.employee_id.toLowerCase().includes(q);
    const matchesType = !typeFilter || r.deduction_type_id === typeFilter;
    return matchesSearch && matchesType;
  });

  const bulk = useBulkSelect(filteredRows.map((r) => r.id));

  const handleBulkDelete = async () => {
    if (
      !(await confirmDialog({
        title: `Hapus ${bulk.count} cicilan?`,
        description:
          "Cicilan yang dicentang akan dihapus. Yang sudah pernah kepotong tetap aman di riwayat payroll, cuma berhenti & hilang dari daftar ini.",
        confirmText: "Hapus",
      }))
    )
      return;
    setBulkDeleting(true);
    const { error } = await supabase.from("rider_installments").delete().in("id", [...bulk.selected]);
    setBulkDeleting(false);
    if (error) return toast.error(error.message);
    toast.success(`${bulk.count} cicilan dihapus`);
    bulk.clear();
    load();
  };

  const remove = async (r: Inst & { rider?: Rider; type?: DType }) => {
    const paid = (r.installments_paid ?? 0) > 0;
    const desc = paid
      ? `Milik ${r.rider?.full_name}.\n\nSudah terpotong ${r.installments_paid}× di payroll sebelumnya — potongan yang SUDAH tercatat tidak berubah, cicilan ini cuma berhenti & hilang dari daftar.`
      : `Milik ${r.rider?.full_name}.\n\nBelum pernah kepotong, jadi aman dihapus.`;
    if (
      !(await confirmDialog({
        title: `Hapus cicilan ${r.type?.name}?`,
        description: desc,
        confirmText: "Hapus",
      }))
    )
      return;
    setDeletingId(r.id);
    const { error } = await supabase.from("rider_installments").delete().eq("id", r.id);
    setDeletingId(null);
    if (error) return toast.error(error.message);
    toast.success("Cicilan dihapus");
    load();
  };

  const { pageSize, setPageSize, page, setPage, totalPages, paged, from, to, total } =
    usePagination(filteredRows, 10);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          placeholder="Cari nama / kode rider…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-md border-2 border-border-strong bg-background px-3 py-1.5 text-sm w-56 outline-none focus:ring-1 focus:ring-ring"
        />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded-md border-2 border-border-strong bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="">Semua jenis potongan</option>
          {typeOptions.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      {!loading && rows.length > 0 && (
        <div className="flex justify-end mb-2">
          <PageSizeSelect pageSize={pageSize} setPageSize={setPageSize} />
        </div>
      )}
      <div className="rounded-xl border-[3px] border-border-strong bg-card shadow-[6px_6px_0_0_var(--color-border-strong)] overflow-hidden">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-border">
              <th className="p-3 w-8">
                <input
                  type="checkbox"
                  checked={bulk.allSelected}
                  onChange={bulk.toggleAll}
                  className="rounded border-border"
                />
              </th>
              <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-3">
                Rider
              </th>
              <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-3">
                Jenis
              </th>
              <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-3">
                Mode / Tarif
              </th>
              <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-3">
                Progress
              </th>
              <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-3">Pemberi Kasbon</th>
              <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-3">
                Mulai
              </th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="p-8 text-center">
                  <Loader2 className="w-4 h-4 animate-spin inline text-primary" />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-muted-foreground text-[11px]">
                  Tidak ada cicilan aktif
                </td>
              </tr>
            ) : (
              paged.map((r) => (
                <Fragment key={r.id}>
                  <tr className="border-b border-border last:border-b-0 hover:bg-muted/40 transition-colors">
                    <td className="p-3">
                      <input
                        type="checkbox"
                        checked={bulk.selected.has(r.id)}
                        onChange={() => bulk.toggle(r.id)}
                        className="rounded border-border"
                      />
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-primary-soft grid place-items-center text-[11px] font-semibold text-primary flex-shrink-0">
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
                      {r.client && (
                        <span className="block text-[10px] font-medium text-primary">
                          Prioritas: {r.client.name}
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-muted-foreground">
                      {r.mode === "daily" || r.mode === "monthly" ? (
                        <div className="space-y-0.5">
                          <span>Rp{Number(r.daily_rate ?? 0).toLocaleString("id-ID")}/hari</span>
                          {r.mode === "monthly" && (
                            <span className="block text-[10px] font-medium text-muted-foreground">
                              Potong per siklus tgl {r.cycle_start_day ?? 25}
                            </span>
                          )}
                          {r.charge_target === "client_revenue" && (
                            <span className="block text-[10px] font-medium text-primary">
                              Ditanggung Revenue Client
                            </span>
                          )}
                        </div>
                      ) : (
                        <span>Rp{Number(r.per_period_amount ?? 0).toLocaleString("id-ID")}/periode</span>
                      )}
                    </td>
                    <td className="p-3">
                      {r.type?.code === "KASBON" ? (recipients.find((x) => x.id === (r as any).kasbon_recipient_id)?.name ?? <span className="text-warning text-[11px]">Belum dipetakan</span>) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="p-3 text-muted-foreground">
                      {r.mode === "daily" || r.mode === "monthly" ? (
                        <span className="text-[10px] uppercase tracking-wide">Ongoing</span>
                      ) : (
                        `${r.installments_paid}/${r.installment_count}`
                      )}
                    </td>
                    <td className="p-3 text-muted-foreground">{r.start_date}</td>
                    <td className="text-right pr-3 space-x-1">
                      <button
                        onClick={() => startEdit(r)}
                        className="p-1.5 hover:bg-muted rounded-md text-muted-foreground hover:text-primary transition-colors"
                        title="Edit cicilan"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => remove(r)}
                        disabled={deletingId === r.id}
                        className="p-1.5 hover:bg-destructive/10 text-muted-foreground hover:text-destructive rounded-md disabled:opacity-50 transition-colors"
                        title="Hapus cicilan"
                      >
                        {deletingId === r.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </td>
                  </tr>
                  {editingId === r.id && (
                    <tr className="border-b border-border/60 bg-muted/20">
                      <td colSpan={8} className="p-3">
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5 items-end text-sm">
                          <div>
                            <label className="text-xs font-medium text-muted-foreground">
                              Jenis
                            </label>
                            <select
                              value={ef.deduction_type_id}
                              onChange={(e) => setEf({ ...ef, deduction_type_id: e.target.value })}
                              className="mt-1 w-full rounded-md border-2 border-border-strong bg-background px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
                            >
                              {/* Jenis yang lagi kepake tapi udah nonaktif/gak-bisa-dicicil tetep
                                ditampilin (biar select-nya gak diam-diam kosong), taruh di atas. */}
                              {r.type && !types.some((t) => t.id === r.deduction_type_id) && (
                                <option value={r.type.id}>{r.type.name} (nonaktif)</option>
                              )}
                              {types.map((t) => (
                                <option key={t.id} value={t.id}>
                                  {t.name}
                                </option>
                              ))}
                            </select>
                          </div>
                          {r.type?.code === "KASBON" && (
                            <div>
                              <label className="text-xs font-medium text-muted-foreground">Pemberi Kasbon</label>
                              <select value={(ef as any).kasbon_recipient_id} onChange={(e) => setEf({ ...ef, kasbon_recipient_id: e.target.value } as any)} className="mt-1 w-full rounded-md border-2 border-border-strong bg-background px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring">
                                <option value="">— belum dipetakan —</option>
                                {recipients.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.bank_name} · {x.account_number}</option>)}
                              </select>
                            </div>
                          )}
                          <div>
                            <label className="text-xs font-medium text-muted-foreground">
                              Client Prioritas
                            </label>
                            <ClientCombobox
                              value={ef.client_id}
                              onChange={(v) => setEf({ ...ef, client_id: v })}
                              placeholder="— pakai client rumah rider —"
                              className="mt-1 w-full text-sm py-1.5"
                              options={clients.map((c) => ({ value: c.id, label: c.name }))}
                            />
                          </div>
                          <div>
                            <label className="text-xs font-medium text-muted-foreground">
                              Mode
                            </label>
                            <select
                              value={ef.mode}
                              disabled={r.installments_paid > 0}
                              title={
                                r.installments_paid > 0
                                  ? `Gak bisa diganti — udah kepotong ${r.installments_paid}×`
                                  : undefined
                              }
                              onChange={(e) => setEf({ ...ef, mode: e.target.value as "fixed" | "daily" | "monthly" })}
                              className="mt-1 w-full rounded-md border-2 border-border-strong bg-background px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                            >
                              <option value="fixed">Cicilan (fixed)</option>
                              <option value="daily">Sewa harian (daily)</option>
                              <option value="monthly">Sewa bulanan (monthly)</option>
                            </select>
                          </div>
                          {ef.mode === "daily" || ef.mode === "monthly" ? (
                            <>
                              <div>
                                <label className="text-xs font-medium text-muted-foreground">
                                  Tarif per Hari (Rp)
                                </label>
                                <input
                                  inputMode="numeric"
                                  value={ef.daily_rate ? ef.daily_rate.toLocaleString("id-ID") : ""}
                                  onChange={(e) => setEf({ ...ef, daily_rate: parseRupiah(e.target.value) })}
                                  className="mt-1 w-full rounded-md border-2 border-border-strong bg-background px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
                                />
                              </div>
                              {ef.mode === "monthly" && (
                                <div>
                                  <label className="text-xs font-medium text-muted-foreground">
                                    Tgl Mulai Siklus
                                  </label>
                                  <input
                                    type="number"
                                    min={1}
                                    max={31}
                                    value={ef.cycle_start_day}
                                    onChange={(e) =>
                                      setEf({ ...ef, cycle_start_day: Math.min(31, Math.max(1, +e.target.value || 1)) })
                                    }
                                    className="mt-1 w-full rounded-md border-2 border-border-strong bg-background px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
                                  />
                                </div>
                              )}
                              <div>
                                <label className="text-xs font-medium text-muted-foreground">
                                  Ditanggung
                                </label>
                                <select
                                  value={ef.charge_target}
                                  onChange={(e) =>
                                    setEf({ ...ef, charge_target: e.target.value as "rider" | "client_revenue" })
                                  }
                                  className="mt-1 w-full rounded-md border-2 border-border-strong bg-background px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
                                >
                                  <option value="rider">Rider (net pay)</option>
                                  <option value="client_revenue">Revenue Client</option>
                                </select>
                              </div>
                            </>
                          ) : (
                            <>
                              <div>
                                <label className="text-xs font-medium text-muted-foreground">
                                  Total (Rp)
                                </label>
                                <input
                                  inputMode="numeric"
                                  value={ef.total_amount ? ef.total_amount.toLocaleString("id-ID") : ""}
                                  onChange={(e) =>
                                    setEf({ ...ef, total_amount: parseRupiah(e.target.value) })
                                  }
                                  className="mt-1 w-full rounded-md border-2 border-border-strong bg-background px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
                                />
                              </div>
                              <div>
                                <label className="text-xs font-medium text-muted-foreground">
                                  Jumlah Cicilan
                                </label>
                                <input
                                  type="number"
                                  min={r.installments_paid || 1}
                                  value={ef.installment_count}
                                  onChange={(e) => setEf({ ...ef, installment_count: +e.target.value })}
                                  className="mt-1 w-full rounded-md border-2 border-border-strong bg-background px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
                                />
                                <p className="text-[11px] text-muted-foreground mt-0.5">
                                  Per periode: Rp
                                  {(ef.total_amount / Math.max(1, ef.installment_count)).toLocaleString(
                                    "id-ID",
                                  )}
                                </p>
                              </div>
                            </>
                          )}
                          <div>
                            <label className="text-xs font-medium text-muted-foreground">
                              Potong Berikutnya
                            </label>
                            <input
                              type="date"
                              value={ef.next_deduction_date}
                              onChange={(e) =>
                                setEf({ ...ef, next_deduction_date: e.target.value })
                              }
                              className="mt-1 w-full rounded-md border-2 border-border-strong bg-background px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
                            />
                          </div>
                          <div>
                            <label className="text-xs font-medium text-muted-foreground">
                              Catatan
                            </label>
                            <input
                              value={ef.notes}
                              onChange={(e) => setEf({ ...ef, notes: e.target.value })}
                              className="mt-1 w-full rounded-md border-2 border-border-strong bg-background px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
                            />
                          </div>
                        </div>
                        <div className="flex justify-end gap-2 mt-2.5">
                          <button
                            onClick={() => setEditingId(null)}
                            className="rounded-md border-2 border-border-strong bg-card px-3 py-1.5 text-sm font-medium hover:bg-muted"
                          >
                            Batal
                          </button>
                          <button
                            onClick={() => saveEdit(r)}
                            disabled={saving}
                            className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm disabled:opacity-50"
                          >
                            {saving ? "Menyimpan…" : "Simpan"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>
      {!loading && (
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
        label="cicilan"
        deleting={bulkDeleting}
        onDelete={handleBulkDelete}
        onClear={bulk.clear}
      />
    </div>
  );
}
