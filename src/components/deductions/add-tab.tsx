import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { parseRupiah } from "@/lib/format";
import { toast } from "sonner";
import { ClientCombobox } from "@/components/client-combobox";
import { DatePicker } from "@/components/date-picker";
import type { Client, DType, MolisType, Rider } from "./types";

export function AddTab() {
  const [riders, setRiders] = useState<Rider[]>([]);
  const [types, setTypes] = useState<DType[]>([]);
  const [molisTypes, setMolisTypes] = useState<MolisType[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [recipients, setRecipients] = useState<{ id: string; name: string; bank_name: string; account_number: string; account_holder: string }[]>([]);
  const [f, setF] = useState({
    rider_ids: [] as string[],
    deduction_type_id: "",
    mode: "fixed" as "fixed" | "daily" | "monthly",
    total_amount: 0,
    daily_rate: 0,
    cycle_start_day: 25,
    molis_type_id: "",
    charge_target: "rider" as "rider" | "client_revenue",
    client_id: "",
    start_date: new Date().toISOString().slice(0, 10),
    installment: false,
    installment_count: 1,
    notes: "",
    kasbon_recipient_id: "",
  });
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);

  const filtered = riders.filter((r) => {
    const q = search.trim().toLowerCase();
    return !q || r.full_name.toLowerCase().includes(q) || r.employee_id.toLowerCase().includes(q);
  });
  const selectedTypeName = types.find((type) => type.id === f.deduction_type_id)?.name ?? "Belum dipilih";
  const selectedMode = f.mode === "fixed" ? "Cicilan tetap" : f.mode === "daily" ? "Per hari" : "Per bulan";
  const summaryAmount = f.mode === "fixed" ? f.total_amount : f.daily_rate;
  const toggleRider = (id: string) =>
    setF((p) => ({
      ...p,
      rider_ids: p.rider_ids.includes(id)
        ? p.rider_ids.filter((x) => x !== id)
        : [...p.rider_ids, id],
    }));

  useEffect(() => {
    supabase
      .from("riders")
      .select("id, employee_id, full_name")
      .order("full_name")
      .then(({ data }) => setRiders(data ?? []));
    // jenis "otomatis" ga muncul di sini — dia kepotong sendiri tiap payroll, ga perlu didaftarin manual
    (supabase as any)
      .from("deduction_types")
      .select("*")
      .eq("active", true)
      .eq("auto_recurring", false)
      .then(({ data }: any) => setTypes(data ?? []));
    (supabase as any)
      .from("molis_types")
      .select("*")
      .eq("active", true)
      .order("name")
      .then(({ data }: any) => setMolisTypes(data ?? []));
    (supabase as any)
      .from("clients")
      .select("id, name")
      .order("name")
      .then(({ data }: any) => setClients(data ?? []));
    (supabase as any).from("kasbon_recipients").select("id, name, bank_name, account_number, account_holder").eq("active", true).order("name")
      .then(({ data }: any) => setRecipients(data ?? []));
  }, []);

  const save = async () => {
    if (f.rider_ids.length === 0) return toast.error("Pilih minimal 1 rider");
    if (!f.deduction_type_id) return toast.error("Lengkapi jenis potongan");
    if ((f.mode === "daily" || f.mode === "monthly") && !f.daily_rate)
      return toast.error("Isi tarif per hari");
    if (f.mode === "fixed" && !f.total_amount) return toast.error("Isi nominal total");
    const selectedType = types.find((type) => type.id === f.deduction_type_id);
    if (selectedType?.code === "KASBON" && !f.kasbon_recipient_id)
      return toast.error("Pilih pemberi kasbon dan rekening penerima");
    setSaving(true);
    const count = f.installment ? Math.max(1, f.installment_count) : 1;
    const per = +(f.total_amount / count).toFixed(2);
    const isMolisMode = f.mode === "daily" || f.mode === "monthly";
    const rows = f.rider_ids.map((rid) => ({
      rider_id: rid,
      deduction_type_id: f.deduction_type_id,
      mode: f.mode,
      total_amount: f.mode === "fixed" ? f.total_amount : null,
      installment_count: f.mode === "fixed" ? count : null,
      per_period_amount: f.mode === "fixed" ? per : null,
      daily_rate: isMolisMode ? f.daily_rate : null,
      cycle_start_day: f.mode === "monthly" ? f.cycle_start_day : null,
      molis_type_id: isMolisMode ? f.molis_type_id || null : null,
      charge_target: isMolisMode ? f.charge_target : "rider",
      client_id: f.client_id || null,
      start_date: f.start_date,
      next_deduction_date: f.start_date,
      notes: f.notes || null,
      kasbon_recipient_id: selectedType?.code === "KASBON" ? f.kasbon_recipient_id : null,
    }));
    const { error } = await supabase.from("rider_installments").insert(rows);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(`Potongan ditambahkan ke ${f.rider_ids.length} rider`);
    setF({
      ...f,
      rider_ids: [],
      total_amount: 0,
      daily_rate: 0,
      cycle_start_day: 25,
      molis_type_id: "",
      charge_target: "rider",
      client_id: "",
      notes: "",
      kasbon_recipient_id: "",
    });
    setSearch("");
  };

  return (
    <div className="max-w-lg space-y-3 text-sm">
      <div>
        <label className="font-medium">
          Rider{" "}
          <span className="font-normal text-muted-foreground">({f.rider_ids.length} dipilih)</span>
        </label>
        <input
          placeholder="Cari nama / kode rider…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mt-1 w-full rounded-md border-2 border-border-strong bg-background px-3 py-2 outline-none focus:ring-1 focus:ring-ring"
        />
        <div className="mt-1.5 flex items-center gap-3 text-xs">
          <button
            type="button"
            onClick={() =>
              setF((p) => ({
                ...p,
                rider_ids: Array.from(new Set([...p.rider_ids, ...filtered.map((r) => r.id)])),
              }))
            }
            className="text-primary hover:underline"
          >
            Pilih semua{search ? ` (${filtered.length})` : ""}
          </button>
          <button
            type="button"
            onClick={() => setF((p) => ({ ...p, rider_ids: [] }))}
            className="text-muted-foreground hover:text-foreground"
          >
            Hapus pilihan
          </button>
        </div>
        <div className="mt-2 max-h-56 overflow-y-auto rounded-md border-2 border-border-strong divide-y divide-border">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-muted-foreground text-xs">Ga ada rider cocok</div>
          ) : (
            filtered.map((r) => (
              <label
                key={r.id}
                className="flex items-center gap-2.5 px-3 py-2 hover:bg-muted cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={f.rider_ids.includes(r.id)}
                  onChange={() => toggleRider(r.id)}
                />
                <span className="font-mono text-xs text-muted-foreground">{r.employee_id}</span>
                <span>{r.full_name}</span>
              </label>
            ))
          )}
        </div>
      </div>
      <div>
        <label className="font-medium">Jenis Potongan</label>
        <select
          value={f.deduction_type_id}
          onChange={(e) => {
            const id = e.target.value;
            const t = types.find((x) => x.id === id);
            // reset "Dicicil" kalau jenis yang dipilih tidak boleh dicicil
            setF({
              ...f,
              deduction_type_id: id,
              installment: t?.installmentable ? f.installment : false,
              kasbon_recipient_id: "",
            });
          }}
          className="mt-1 w-full rounded-md border-2 border-border-strong bg-background px-3 py-2 outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="">— pilih jenis —</option>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="font-medium">
          Client Prioritas <span className="font-normal text-muted-foreground">(opsional)</span>
        </label>
        <ClientCombobox
          value={f.client_id}
          onChange={(v) => setF({ ...f, client_id: v })}
          placeholder="— pakai client rumah rider —"
          className="mt-1 w-full text-sm py-2"
          options={clients.map((c) => ({ value: c.id, label: c.name }))}
        />
        <p className="text-xs text-muted-foreground mt-1">
          Potongan ini cuma kepotong di payroll run client ini. Kalau fee rider di client ini gak
          cukup, sisa kurangnya bisa "dititip" ke client lain lewat netting manual di Payroll Run
          (butuh approve admin dulu, gak otomatis kepotong).
        </p>
      </div>
      {types.find((type) => type.id === f.deduction_type_id)?.code === "KASBON" && (
        <div className="rounded-xl border border-warning/30 bg-warning/5 p-3 space-y-2">
          <div>
            <label className="font-medium">Pemberi Kasbon</label>
            <select value={f.kasbon_recipient_id} onChange={(e) => setF({ ...f, kasbon_recipient_id: e.target.value })} className="mt-1 w-full rounded-md border-2 border-border-strong bg-background px-3 py-2 outline-none focus:ring-1 focus:ring-ring">
              <option value="">— pilih penerima transfer —</option>
              {recipients.map((r) => <option key={r.id} value={r.id}>{r.name} · {r.bank_name} · {r.account_number}</option>)}
            </select>
            <p className="mt-1 text-[11px] text-muted-foreground">Dana yang benar-benar tertagih akan masuk settlement ke rekening ini.</p>
          </div>
          <p className="text-xs text-muted-foreground">Belum ada penerima? Tambahkan dari menu master Penerima Kasbon terlebih dahulu.</p>
        </div>
      )}
      <div className="deduction-mode-picker rounded-md border border-border p-3">
        <label className="font-medium text-xs">Mode Potongan</label>
        <div className="mt-1.5 grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => setF({ ...f, mode: "fixed" })}
            className={`deduction-mode-option text-left rounded-md px-3 py-2 border-2 text-xs ${f.mode === "fixed" ? "border-border-strong bg-primary text-primary-foreground" : "border-border"}`}
          >
            <span className="font-medium block">Cicilan tetap</span>
            <span className="text-muted-foreground">Total dibagi N kali, mis. kerusakan barang/kasbon</span>
          </button>
          <button
            type="button"
            onClick={() => setF({ ...f, mode: "daily" })}
            className={`deduction-mode-option text-left rounded-md px-3 py-2 border-2 text-xs ${f.mode === "daily" ? "border-border-strong bg-primary text-primary-foreground" : "border-border"}`}
          >
            <span className="font-medium block">Per hari</span>
            <span className="text-muted-foreground">
              Tarif × jumlah hari periode, mis. sewa motor — tetap kepotong walau rider libur, jalan
              terus sampai dinonaktifkan manual
            </span>
          </button>
          <button
            type="button"
            onClick={() => setF({ ...f, mode: "monthly" })}
            className={`deduction-mode-option text-left rounded-md px-3 py-2 border-2 text-xs ${f.mode === "monthly" ? "border-border-strong bg-primary text-primary-foreground" : "border-border"}`}
          >
            <span className="font-medium block">Per bulan</span>
            <span className="text-muted-foreground">
              Tarif harian tetap dipakai buat hitung, cuma nagihnya digabung 1x per siklus custom
              (mis. tgl 25 - 24), bukan tiap payroll run
            </span>
          </button>
        </div>
      </div>
      {f.mode === "fixed" ? (
        <div>
          <label className="font-medium">Nominal Total (Rp)</label>
          <input
            inputMode="numeric"
            placeholder="0"
            value={f.total_amount ? f.total_amount.toLocaleString("id-ID") : ""}
            onChange={(e) => setF({ ...f, total_amount: parseRupiah(e.target.value) })}
            className="mt-1 w-full rounded-md border-2 border-border-strong bg-background px-3 py-2 outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      ) : (
        <div className="space-y-3">
          {molisTypes.length > 0 && (
            <div>
              <label className="font-medium">Jenis Molis</label>
              <select
                value={f.molis_type_id}
                onChange={(e) => {
                  const id = e.target.value;
                  const mt = molisTypes.find((m) => m.id === id);
                  setF({
                    ...f,
                    molis_type_id: id,
                    daily_rate: mt ? mt.default_daily_rate : f.daily_rate,
                  });
                }}
                className="mt-1 w-full rounded-md border-2 border-border-strong bg-background px-3 py-2 outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">— bukan molis / manual —</option>
                {molisTypes.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} (Rp{Number(m.default_daily_rate).toLocaleString("id-ID")}/hari)
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="font-medium">Tarif per Hari (Rp)</label>
            <input
              inputMode="numeric"
              placeholder="mis. 38.000"
              value={f.daily_rate ? f.daily_rate.toLocaleString("id-ID") : ""}
              onChange={(e) => setF({ ...f, daily_rate: parseRupiah(e.target.value) })}
              className="mt-1 w-full rounded-md border-2 border-border-strong bg-background px-3 py-2 outline-none focus:ring-1 focus:ring-ring"
            />
            {f.mode === "daily" ? (
              <p className="text-xs text-muted-foreground mt-1">
                Tiap payroll digenerate, dikali jumlah hari kalender di periode itu (bukan cuma hari
                rider jalan). Tarif dari jenis molis di atas cuma autofill — tetap bisa diedit manual
                kalau beda untuk client ini.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground mt-1">
                Tetap dihitung tarif × jumlah hari, cuma ditagih SEKALIGUS 1x per siklus di bawah —
                run lain dalam siklus yang sama gak kena lagi.
              </p>
            )}
          </div>
          {f.mode === "monthly" && (
            <div>
              <label className="font-medium">Tanggal Mulai Siklus</label>
              <input
                type="number"
                min={1}
                max={31}
                value={f.cycle_start_day}
                onChange={(e) => setF({ ...f, cycle_start_day: Math.min(31, Math.max(1, +e.target.value || 1)) })}
                className="mt-1 w-32 rounded-md border border-border bg-background px-3 py-2"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Siklus tagihan: tgl {f.cycle_start_day} bulan ini — tgl {f.cycle_start_day - 1 || 31}{" "}
                bulan depan. Default 25 (siklus 25 - 24), sesuaikan kalau beda buat rider/client ini.
              </p>
            </div>
          )}
          <div>
            <label className="font-medium">Siapa yang Menanggung</label>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setF({ ...f, charge_target: "rider" })}
                className={`text-left rounded-md px-3 py-2 border text-xs ${f.charge_target === "rider" ? "border-primary bg-primary-soft" : "border-border"}`}
              >
                <span className="font-medium block">Rider</span>
                <span className="text-muted-foreground">Potong dari net pay rider (default)</span>
              </button>
              <button
                type="button"
                onClick={() => setF({ ...f, charge_target: "client_revenue" })}
                className={`text-left rounded-md px-3 py-2 border text-xs ${f.charge_target === "client_revenue" ? "border-primary bg-primary-soft" : "border-border"}`}
              >
                <span className="font-medium block">Revenue Client</span>
                <span className="text-muted-foreground">
                  Rider tetap terima fee penuh — biaya masuk cost P&amp;L client ini
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
      <div>
        <label className="font-medium">Tanggal Mulai</label>
        <DatePicker value={f.start_date} onChange={(v) => setF({ ...f, start_date: v })} className="mt-1 w-full" />
      </div>
      {f.mode === "fixed" &&
        (() => {
          const canInstallment = !!types.find((t) => t.id === f.deduction_type_id)?.installmentable;
          return (
            <>
              <label
                className={`flex items-center gap-2 ${canInstallment ? "" : "opacity-50 cursor-not-allowed"}`}
              >
                <input
                  type="checkbox"
                  disabled={!canInstallment}
                  checked={f.installment && canInstallment}
                  onChange={(e) => setF({ ...f, installment: e.target.checked })}
                />{" "}
                Dicicil
              </label>
              {f.deduction_type_id && !canInstallment && (
                <p className="text-xs text-muted-foreground">
                  Jenis potongan ini tidak bisa dicicil.
                </p>
              )}
            </>
          );
        })()}
      {f.mode === "fixed" && f.installment && (
        <div>
          <label className="font-medium">Jumlah Cicilan</label>
          <input
            type="number"
            min={1}
            value={f.installment_count}
            onChange={(e) => setF({ ...f, installment_count: +e.target.value })}
            className="mt-1 w-full rounded-md border-2 border-border-strong bg-background px-3 py-2 outline-none focus:ring-1 focus:ring-ring"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Per periode: Rp
            {(f.total_amount / Math.max(1, f.installment_count)).toLocaleString("id-ID")}
          </p>
        </div>
      )}
      <div>
        <label className="font-medium">Catatan</label>
        <input
          value={f.notes}
          onChange={(e) => setF({ ...f, notes: e.target.value })}
          className="mt-1 w-full rounded-md border-2 border-border-strong bg-background px-3 py-2 outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      <div className="deduction-save-area" aria-live="polite">
        <div className="deduction-summary" aria-label="Ringkasan potongan">
          <div><span>Rider</span><strong>{f.rider_ids.length || "—"}</strong></div>
          <div><span>Skema</span><strong>{selectedMode}</strong></div>
          <div><span>Nominal</span><strong>Rp{summaryAmount.toLocaleString("id-ID")}</strong></div>
          <p>{selectedTypeName}</p>
        </div>
        <button
          onClick={save}
          disabled={saving}
          className="deduction-save-button rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm disabled:opacity-50"
        >
          {saving ? "Menyimpan…" : "Simpan Potongan"}
        </button>
      </div>
    </div>
  );
}
