import { Fragment, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { parseRupiah } from "@/lib/format";
import { confirmDialog } from "@/components/confirm-dialog";
import { BulkActionBar } from "@/components/bulk-action-bar";
import { useBulkSelect } from "@/hooks/use-bulk-select";
import { toast } from "sonner";
import { Plus, Trash2, Loader2, X, Users } from "lucide-react";
import type { Client, DType, Rider } from "./types";

export function DTypesTab() {
  const [rows, setRows] = useState<DType[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [nf, setNf] = useState({
    code: "",
    name: "",
    description: "",
    installmentable: false,
    auto_recurring: false,
    recurring_amount: 0,
    trigger_frequency: "every_payroll_run" as "every_payroll_run" | "monthly_once",
    applies_to_all: true,
  });
  const [saving, setSaving] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const bulk = useBulkSelect(rows.map((r) => r.id));

  // Kelola rider mana yang kena buat auto-recurring type dengan
  // applies_to_all=false (mis. BPJS cuma sebagian rider) — dibuka per baris.
  const [managingId, setManagingId] = useState<string | null>(null);
  const [riders, setRiders] = useState<Rider[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [enrolledIds, setEnrolledIds] = useState<Set<string>>(new Set());
  // Client prioritas per rider yang terdaftar (mis. BPJS JKK ridernya kerja di
  // 2 client — pilih client mana yang nanggung, null = client rumah rider).
  const [enrolledClient, setEnrolledClientMap] = useState<Map<string, string | null>>(new Map());
  const [riderSearch, setRiderSearch] = useState("");

  const openManage = async (r: DType) => {
    setManagingId(r.id);
    setRiderSearch("");
    if (riders.length === 0) {
      const { data } = await supabase.from("riders").select("id, employee_id, full_name").order("full_name");
      setRiders(data ?? []);
    }
    if (clients.length === 0) {
      const { data } = await (supabase as any).from("clients").select("id, name").order("name");
      setClients(data ?? []);
    }
    const { data: enrolled } = await (supabase as any)
      .from("deduction_type_riders")
      .select("rider_id, client_id")
      .eq("deduction_type_id", r.id);
    setEnrolledIds(new Set((enrolled ?? []).map((e: { rider_id: string }) => e.rider_id)));
    setEnrolledClientMap(
      new Map((enrolled ?? []).map((e: { rider_id: string; client_id: string | null }) => [e.rider_id, e.client_id])),
    );
  };

  const toggleEnrolled = async (typeId: string, riderId: string) => {
    const isEnrolled = enrolledIds.has(riderId);
    const next = new Set(enrolledIds);
    isEnrolled ? next.delete(riderId) : next.add(riderId);
    setEnrolledIds(next); // optimistic, dibalik lagi kalau gagal
    const { error } = isEnrolled
      ? await (supabase as any).from("deduction_type_riders").delete()
          .eq("deduction_type_id", typeId).eq("rider_id", riderId)
      : await (supabase as any).from("deduction_type_riders").insert({ deduction_type_id: typeId, rider_id: riderId });
    if (error) {
      toast.error(error.message);
      setEnrolledIds(enrolledIds);
    }
  };

  const setEnrolledClient = async (typeId: string, riderId: string, clientId: string) => {
    const prev = enrolledClient.get(riderId) ?? null;
    setEnrolledClientMap(new Map(enrolledClient).set(riderId, clientId || null));
    const { error } = await (supabase as any)
      .from("deduction_type_riders")
      .update({ client_id: clientId || null })
      .eq("deduction_type_id", typeId).eq("rider_id", riderId);
    if (error) {
      toast.error(error.message);
      setEnrolledClientMap(new Map(enrolledClient).set(riderId, prev));
    }
  };

  const toggleAppliesToAll = async (r: DType) => {
    const { error } = await (supabase as any)
      .from("deduction_types")
      .update({ applies_to_all: !r.applies_to_all })
      .eq("id", r.id);
    if (error) return toast.error(error.message);
    load();
  };

  const filteredRiders = riders.filter((r) => {
    const q = riderSearch.trim().toLowerCase();
    return !q || r.full_name.toLowerCase().includes(q) || r.employee_id.toLowerCase().includes(q);
  });

  const load = async () => {
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("deduction_types")
      .select("*")
      .order("name");
    if (error) toast.error(error.message);
    else setRows(data ?? []);
    setLoading(false);
  };
  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    if (!nf.code.trim() || !nf.name.trim()) return toast.error("Kode & nama wajib diisi");
    if (nf.auto_recurring && nf.recurring_amount <= 0)
      return toast.error("Nominal potong otomatis wajib diisi");
    setSaving(true);
    const { error } = await (supabase as any).from("deduction_types").insert({
      code: nf.code.trim().toUpperCase(),
      name: nf.name.trim(),
      description: nf.description.trim() || null,
      installmentable: nf.installmentable,
      auto_recurring: nf.auto_recurring,
      recurring_amount: nf.auto_recurring ? nf.recurring_amount : 0,
      trigger_frequency: nf.auto_recurring ? nf.trigger_frequency : "every_payroll_run",
      applies_to_all: nf.auto_recurring ? nf.applies_to_all : true,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Jenis potongan ditambahkan");
    setNf({
      code: "",
      name: "",
      description: "",
      installmentable: false,
      auto_recurring: false,
      recurring_amount: 0,
      trigger_frequency: "every_payroll_run",
      applies_to_all: true,
    });
    setAdding(false);
    load();
  };
  const remove = async (r: DType) => {
    if (
      !(await confirmDialog({
        title: "Hapus jenis potongan?",
        description: `"${r.name}" akan dihapus permanen.`,
        confirmText: "Hapus",
      }))
    )
      return;
    const { error } = await (supabase as any).from("deduction_types").delete().eq("id", r.id);
    if (!error) {
      toast.success("Jenis potongan dihapus");
      return load();
    }
    // Kalau masih dipakai cicilan/potongan tercatat → FK error. Tawarin nonaktifin.
    const inUse = (error as any).code === "23503" || /foreign key/i.test(error.message);
    if (inUse) {
      if (
        await confirmDialog({
          title: "Tidak bisa dihapus",
          description: `"${r.name}" masih dipakai potongan/cicilan yang sudah tercatat.\n\nNonaktifkan saja? Jenis ini tidak muncul lagi saat bikin potongan baru, tapi data lama tetap aman.`,
          confirmText: "Nonaktifkan",
          danger: false,
        })
      ) {
        const { error: e2 } = await (supabase as any)
          .from("deduction_types")
          .update({ active: false })
          .eq("id", r.id);
        if (e2) return toast.error(e2.message);
        toast.success("Jenis potongan dinonaktifkan");
        load();
      }
      return;
    }
    toast.error(error.message);
  };

  const handleBulkDelete = async () => {
    if (
      !(await confirmDialog({
        title: `Hapus ${bulk.count} jenis potongan?`,
        description: "Jenis yang masih dipakai cicilan/potongan tercatat gak akan kehapus — hapus itu satu-satu biar bisa dipilih nonaktifkan aja.",
        confirmText: "Hapus",
      }))
    )
      return;
    setBulkDeleting(true);
    const { error } = await (supabase as any)
      .from("deduction_types")
      .delete()
      .in("id", [...bulk.selected]);
    setBulkDeleting(false);
    if (error) {
      const inUse = (error as any).code === "23503" || /foreign key/i.test(error.message);
      return toast.error(
        inUse
          ? "Sebagian masih dipakai cicilan/potongan tercatat — gak ada yang kehapus. Hapus satu-satu biar bisa ditawarin nonaktifkan."
          : error.message,
      );
    }
    toast.success(`${bulk.count} jenis potongan dihapus`);
    bulk.clear();
    load();
  };

  const toggleActive = async (r: DType) => {
    const { error } = await (supabase as any)
      .from("deduction_types")
      .update({ active: !r.active })
      .eq("id", r.id);
    if (error) return toast.error(error.message);
    toast.success(r.active ? "Dinonaktifkan" : "Diaktifkan");
    load();
  };

  const inputCls = "mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm";

  return (
    <div>
      <div className="flex justify-end mb-3">
        <button
          onClick={() => setAdding((v) => !v)}
          className="inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm"
        >
          <Plus className="w-4 h-4" /> Tambah Jenis
        </button>
      </div>

      {adding && (
        <div className="rounded-lg border border-border bg-card p-4 mb-3">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium">Jenis Potongan Baru</h3>
            <button
              onClick={() => setAdding(false)}
              className="p-1 text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">Kode</label>
              <input
                value={nf.code}
                onChange={(e) => setNf({ ...nf, code: e.target.value })}
                placeholder="mis. SIM, BBM"
                className={inputCls}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Nama</label>
              <input
                value={nf.name}
                onChange={(e) => setNf({ ...nf, name: e.target.value })}
                placeholder="mis. Cicilan SIM"
                className={inputCls}
              />
            </div>
          </div>
          <div className="mt-3">
            <label className="text-sm font-medium">
              Keterangan <span className="font-normal text-muted-foreground">(opsional)</span>
            </label>
            <input
              value={nf.description}
              onChange={(e) => setNf({ ...nf, description: e.target.value })}
              className={inputCls}
            />
          </div>
          <label className="flex items-center gap-2 mt-3 text-sm">
            <input
              type="checkbox"
              checked={nf.installmentable}
              onChange={(e) =>
                setNf({
                  ...nf,
                  installmentable: e.target.checked,
                  auto_recurring: e.target.checked ? false : nf.auto_recurring,
                })
              }
            />{" "}
            Bisa dicicil{" "}
            <span className="text-muted-foreground text-xs">
              (termasuk mode "per hari" mis. sewa motor — diatur per rider pas ditambahin)
            </span>
          </label>
          <label className="flex items-center gap-2 mt-2 text-sm">
            <input
              type="checkbox"
              checked={nf.auto_recurring}
              onChange={(e) =>
                setNf({
                  ...nf,
                  auto_recurring: e.target.checked,
                  installmentable: e.target.checked ? false : nf.installmentable,
                })
              }
            />
            Potong otomatis tiap periode{" "}
            <span className="text-muted-foreground text-xs">(semua rider yg ada penghasilan)</span>
          </label>
          {nf.auto_recurring && (
            <div className="mt-3 space-y-3">
              <div>
                <label className="text-sm font-medium">Nominal Potong per Periode (Rp)</label>
                <input
                  inputMode="numeric"
                  placeholder="mis. 2.500"
                  value={nf.recurring_amount ? nf.recurring_amount.toLocaleString("id-ID") : ""}
                  onChange={(e) => setNf({ ...nf, recurring_amount: parseRupiah(e.target.value) })}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Frekuensi Potong</label>
                <select
                  value={nf.trigger_frequency}
                  onChange={(e) =>
                    setNf({ ...nf, trigger_frequency: e.target.value as "every_payroll_run" | "monthly_once" })
                  }
                  className={inputCls}
                >
                  <option value="every_payroll_run">Tiap payroll run</option>
                  <option value="monthly_once">Sekali per bulan (mis. BPJS)</option>
                </select>
                <p className="text-xs text-muted-foreground mt-1">
                  "Sekali per bulan" berlaku per rider lintas client manapun dia digaji — kalau
                  client-nya digaji &gt;1x/bulan (kayak Wicked Pies), gak dobel kepotong.
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={nf.applies_to_all}
                  onChange={(e) => setNf({ ...nf, applies_to_all: e.target.checked })}
                />
                Berlaku untuk semua rider{" "}
                <span className="text-muted-foreground text-xs">
                  (uncheck kalau cuma sebagian rider yang ikut, mis. BPJS — bisa dipilih ridernya
                  setelah disimpan)
                </span>
              </label>
            </div>
          )}
          <div className="flex justify-end gap-2 mt-4">
            <button
              onClick={() => setAdding(false)}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-sm hover:bg-muted"
            >
              Batal
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm disabled:opacity-50"
            >
              {saving ? "Menyimpan…" : "Simpan"}
            </button>
          </div>
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
                Kode
              </th>
              <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-3">
                Nama
              </th>
              <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-3">
                Bisa Dicicil
              </th>
              <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-3">
                Otomatis
              </th>
              <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-3">
                Status
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
                  Belum ada jenis potongan
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <Fragment key={r.id}>
                <tr
                  className="border-b border-border last:border-b-0 hover:bg-muted/40 transition-colors"
                >
                  <td className="p-3">
                    <input
                      type="checkbox"
                      checked={bulk.selected.has(r.id)}
                      onChange={() => bulk.toggle(r.id)}
                      className="rounded border-border"
                    />
                  </td>
                  <td
                    className="p-3 text-muted-foreground"
                    style={{ fontFamily: "'JetBrains Mono', monospace" }}
                  >
                    {r.code}
                  </td>
                  <td className="p-3 font-medium text-foreground">{r.name}</td>
                  <td className="p-3 text-muted-foreground">
                    {r.installmentable ? "Ya" : "Tidak"}
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {r.auto_recurring ? (
                      <div className="space-y-1">
                        <span className="text-primary font-medium block">
                          Ya · Rp{Number(r.recurring_amount).toLocaleString("id-ID")} ·{" "}
                          {r.trigger_frequency === "monthly_once" ? "bulanan" : "tiap run"}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => toggleAppliesToAll(r)}
                            title="Klik untuk ganti"
                            className={`text-[10px] font-medium px-2 py-0.5 rounded-full border-2 transition-colors ${r.applies_to_all ? "border-border text-muted-foreground bg-muted hover:bg-muted/70" : "border-border-strong text-primary-foreground bg-primary hover:bg-primary/90"}`}
                          >
                            {r.applies_to_all ? "Semua rider" : "Rider tertentu"}
                          </button>
                          {!r.applies_to_all && (
                            <button
                              onClick={() => openManage(r)}
                              className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-primary"
                            >
                              <Users className="w-3 h-3" /> Kelola
                            </button>
                          )}
                        </div>
                      </div>
                    ) : (
                      "Tidak"
                    )}
                  </td>
                  <td className="p-3">
                    <button
                      onClick={() => toggleActive(r)}
                      title="Klik untuk aktif/nonaktif"
                      className={`text-[10px] font-medium px-2 py-0.5 rounded-full border-2 transition-colors ${r.active ? "border-border-strong bg-success text-success-foreground hover:brightness-105" : "border-border text-muted-foreground bg-muted hover:bg-muted/70"}`}
                    >
                      {r.active ? "Aktif" : "Nonaktif"}
                    </button>
                  </td>
                  <td className="text-right pr-3">
                    <button
                      onClick={() => remove(r)}
                      className="p-1.5 hover:bg-destructive/10 text-muted-foreground hover:text-destructive rounded-md transition-colors"
                      title="Hapus"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
                {managingId === r.id && (
                  <tr className="border-b border-border/60 bg-muted/20">
                    <td colSpan={7} className="p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium">
                          Rider yang kena "{r.name}" ({enrolledIds.size} dipilih)
                        </span>
                        <button
                          onClick={() => setManagingId(null)}
                          className="p-1 text-muted-foreground hover:text-foreground"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <input
                        placeholder="Cari nama / kode rider…"
                        value={riderSearch}
                        onChange={(e) => setRiderSearch(e.target.value)}
                        className="w-full max-w-sm rounded-md border-2 border-border-strong bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
                      />
                      <div className="mt-2 max-h-56 max-w-sm overflow-y-auto rounded-md border-2 border-border-strong divide-y divide-border">
                        {filteredRiders.length === 0 ? (
                          <div className="px-3 py-2 text-muted-foreground text-xs">Ga ada rider cocok</div>
                        ) : (
                          filteredRiders.map((rd) => (
                            <div
                              key={rd.id}
                              className="flex items-center gap-2.5 px-3 py-2 hover:bg-muted text-sm"
                            >
                              <label className="flex items-center gap-2.5 flex-1 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={enrolledIds.has(rd.id)}
                                  onChange={() => toggleEnrolled(r.id, rd.id)}
                                />
                                <span className="font-mono text-xs text-muted-foreground">{rd.employee_id}</span>
                                <span>{rd.full_name}</span>
                              </label>
                              {enrolledIds.has(rd.id) && (
                                <select
                                  value={enrolledClient.get(rd.id) ?? ""}
                                  onChange={(e) => setEnrolledClient(r.id, rd.id, e.target.value)}
                                  className="rounded-md border-2 border-border-strong bg-background px-1.5 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                                  title="Client prioritas — null pakai client rumah rider"
                                >
                                  <option value="">— client rumah rider —</option>
                                  {clients.map((c) => (
                                    <option key={c.id} value={c.id}>
                                      {c.name}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </div>
                          ))
                        )}
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
      <BulkActionBar
        count={bulk.count}
        label="jenis potongan"
        deleting={bulkDeleting}
        onDelete={handleBulkDelete}
        onClear={bulk.clear}
      />
    </div>
  );
}
