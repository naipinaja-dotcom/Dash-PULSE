import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetch-all";
import { formatRupiah } from "@/lib/format";
import { parseEwaLines } from "@/lib/ewa-parse";
import { ClientCombobox } from "@/components/client-combobox";
import { DatePicker } from "@/components/date-picker";
import { toast } from "sonner";
import type { Client, Rider } from "./types";

// Catat EWA (Early Wages): upah yang SUDAH dicairkan duluan lewat request Basecamp
// terpisah. Tiap rider jadi potongan sekali (rider_installments fixed x1) yang otomatis
// kepotong di payroll run pertama yang period_end-nya >= tanggal tarik (lihat
// generatePayrollDetails), jadi payroll reguler gak membayar rider dobel.
export function EwaTab() {
  const [riders, setRiders] = useState<Rider[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [ewaTypeId, setEwaTypeId] = useState<string | null | undefined>(undefined);
  const [clientId, setClientId] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [requestCode, setRequestCode] = useState("");
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    fetchAllRows<Rider>((c, f, t) =>
      c.from("riders").select("id, employee_id, full_name").order("full_name").range(f, t),
    ).then(setRiders);
    (supabase as any)
      .from("clients")
      .select("id, name")
      .order("name")
      .then(({ data }: any) => setClients(data ?? []));
    (supabase as any)
      .from("deduction_types")
      .select("id")
      .eq("code", "EWA")
      .maybeSingle()
      .then(({ data }: any) => setEwaTypeId(data?.id ?? null));
  }, []);

  const { rows, errors } = useMemo(() => parseEwaLines(text, riders), [text, riders]);
  const total = rows.reduce((s, r) => s + r.amount, 0);

  const save = async () => {
    if (!ewaTypeId) return toast.error("Jenis potongan EWA belum ada — jalankan migration EWA dulu.");
    if (!clientId) return toast.error("Pilih project/client dulu.");
    if (!requestCode.trim()) return toast.error("Kode request Basecamp wajib diisi.");
    if (rows.length === 0) return toast.error("Daftar rider kosong.");
    if (errors.length > 0) return toast.error("Perbaiki baris yang bermasalah dulu.");
    setSaving(true);
    const code = requestCode.trim();
    const { error } = await (supabase as any).from("rider_installments").insert(
      rows.map((r) => ({
        rider_id: r.riderId,
        deduction_type_id: ewaTypeId,
        mode: "fixed",
        total_amount: r.amount,
        installment_count: 1,
        per_period_amount: r.amount,
        charge_target: "rider",
        client_id: clientId,
        client_ids: [clientId],
        start_date: date,
        next_deduction_date: date,
        notes: `EWA ${code}`,
        ewa_request_code: code,
      })),
    );
    setSaving(false);
    if (error) {
      return toast.error(
        error.code === "23505"
          ? "Kode request ini sudah pernah dicatat untuk salah satu rider di daftar."
          : error.message,
      );
    }
    toast.success(`${rows.length} rider dicatat, total ${formatRupiah(total)}`);

    // Run yang sudah finalized/published tidak otomatis ikut memotong EWA baru ini.
    const { data: runs } = await (supabase as any)
      .from("payroll_runs")
      .select("name, status")
      .eq("client_id", clientId)
      .lte("period_start", date)
      .gte("period_end", date)
      .in("status", ["finalized", "published"]);
    setNotice(
      runs?.length
        ? `Sudah ada run yang mencakup tanggal ini (${runs.map((r: any) => `${r.name} — ${r.status}`).join("; ")}). EWA baru terpotong kalau run itu dikembalikan ke draft lalu Generate Ulang; kalau tidak, jatuh ke run berikutnya.`
        : null,
    );
    setText("");
    setRequestCode("");
  };

  return (
    <div className="max-w-2xl space-y-3 text-sm">
      {ewaTypeId === null && (
        <div className="rounded-md border-2 border-destructive/50 bg-destructive/10 p-3 text-destructive">
          Jenis potongan EWA belum ada di database. Jalankan migration EWA terlebih dulu.
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="font-medium">Project / client</label>
          <ClientCombobox
            options={clients.map((c) => ({ value: c.id, label: c.name }))}
            value={clientId}
            onChange={setClientId}
            className="mt-1 w-full"
          />
        </div>
        <div>
          <label className="font-medium">Tanggal tarik</label>
          <DatePicker value={date} onChange={setDate} className="mt-1 w-full" />
        </div>
        <div>
          <label className="font-medium">Kode request Basecamp</label>
          <input
            value={requestCode}
            onChange={(e) => setRequestCode(e.target.value)}
            placeholder="OPS-SCH-PM-..."
            className="mt-1 w-full rounded-md border-2 border-border-strong bg-background px-3 py-2 outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </div>

      <div>
        <label className="font-medium">
          Daftar rider{" "}
          <span className="font-normal text-muted-foreground">
            (1 baris per rider: kode mitra, lalu nominal — bisa paste langsung dari spreadsheet)
          </span>
        </label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder={"MTR0001\t257.100\nMTR0002\t100.000"}
          className="mt-1 w-full rounded-md border-2 border-border-strong bg-background px-3 py-2 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      {(rows.length > 0 || errors.length > 0) && (
        <div className="rounded-md border-2 border-border-strong">
          <table className="w-full text-xs">
            <thead className="bg-muted text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5">Kode</th>
                <th className="px-3 py-1.5">Rider</th>
                <th className="px-3 py-1.5 text-right">Nominal</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.riderId} className="border-t border-border">
                  <td className="px-3 py-1.5">{r.employeeId}</td>
                  <td className="px-3 py-1.5">{r.name}</td>
                  <td className="px-3 py-1.5 text-right">{formatRupiah(r.amount)}</td>
                </tr>
              ))}
              {errors.map((e) => (
                <tr key={`e${e.line}`} className="border-t border-border bg-destructive/10 text-destructive">
                  <td className="px-3 py-1.5" colSpan={3}>
                    Baris {e.line}: {e.reason} — <span className="font-mono">{e.raw}</span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border bg-muted font-medium">
                <td className="px-3 py-1.5" colSpan={2}>
                  Total {rows.length} rider (cocokkan dengan nominal request di Basecamp)
                </td>
                <td className="px-3 py-1.5 text-right">{formatRupiah(total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {notice && (
        <div className="rounded-md border-2 border-warning/50 bg-warning/10 p-3 text-xs">{notice}</div>
      )}

      <button
        onClick={save}
        disabled={saving || !ewaTypeId || rows.length === 0 || errors.length > 0}
        className="rounded-md border-2 border-border-strong bg-primary px-4 py-2 font-bold text-primary-foreground disabled:opacity-40"
      >
        {saving ? "Menyimpan..." : `Catat EWA${rows.length ? ` (${rows.length} rider)` : ""}`}
      </button>
    </div>
  );
}
