import { useState } from "react";
import { toast } from "sonner";

type Client = { id: string; name: string };
type Rider = { id: string; full_name: string; employee_id: string };

const WEEKDAYS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

export type ScheduleRow = {
  label: string;
  client_id: string | null;
  rider_id: string | null;
  weekdays: number[];
  period_start_weekday: number | null;
  period_end_weekday: number | null;
  close_same_day: boolean;
};

export function ScheduleFormModal({
  clients,
  riders,
  saving,
  onClose,
  onSave,
}: {
  clients: Client[];
  riders: Rider[];
  saving: boolean;
  onClose: () => void;
  onSave: (rows: ScheduleRow[]) => void;
}) {
  const [label, setLabel] = useState("");
  const [clientIds, setClientIds] = useState<string[]>([]);
  const [riderIds, setRiderIds] = useState<string[]>([]);
  const [clientSearch, setClientSearch] = useState("");
  const [riderSearch, setRiderSearch] = useState("");
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [periodOn, setPeriodOn] = useState(false);
  const [periodStartWeekday, setPeriodStartWeekday] = useState(1); // Senin
  const [periodEndWeekday, setPeriodEndWeekday] = useState(0); // Minggu
  const [closeSameDay, setCloseSameDay] = useState(false);

  const toggleDay = (d: number) =>
    setWeekdays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));
  const toggleClient = (id: string) =>
    setClientIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const toggleRider = (id: string) =>
    setRiderIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const visibleClients = clients.filter((c) =>
    c.name.toLowerCase().includes(clientSearch.toLowerCase()),
  );
  const visibleRiders = riders.filter((r) =>
    `${r.full_name} ${r.employee_id}`.toLowerCase().includes(riderSearch.toLowerCase()),
  );

  // 1 baris = 1 client ATAU 1 rider (bukan kombinasi silang) — pilih banyak
  // client/rider sekaligus di sini cuma bikin banyak baris identik dalam
  // 1x submit, biar ga perlu buka form berkali-kali buat tiap client.
  const submit = () => {
    if (!label.trim()) return toast.error("Label wajib diisi");
    if (clientIds.length === 0 && riderIds.length === 0)
      return toast.error("Pilih minimal 1 client atau rider");
    if (weekdays.length === 0) return toast.error("Pilih minimal 1 hari");
    const period = periodOn
      ? { period_start_weekday: periodStartWeekday, period_end_weekday: periodEndWeekday, close_same_day: closeSameDay }
      : { period_start_weekday: null, period_end_weekday: null, close_same_day: false };
    const rows: ScheduleRow[] = [
      ...clientIds.map((id) => ({ label: label.trim(), client_id: id, rider_id: null, weekdays, ...period })),
      ...riderIds.map((id) => ({ label: label.trim(), client_id: null, rider_id: id, weekdays, period_start_weekday: null, period_end_weekday: null, close_same_day: false })),
    ];
    onSave(rows);
  };

  return (
    <div className="reminder-modal-backdrop fixed inset-0 grid place-items-center z-50 p-4" onClick={onClose}>
      <div
        className="reminder-schedule-modal w-full max-w-lg max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="reminder-modal-header">
          <span data-eyebrow>Disbursement / reminder</span>
          <h2>Jadwal Reminder Baru</h2>
          <p>Susun pengingat untuk batch pembayaran agar tim ops tahu siapa yang perlu ditindaklanjuti.</p>
          <span className="reminder-modal-number" aria-hidden="true">01</span>
        </div>
        <div className="reminder-modal-body space-y-4 text-sm">
          <div className="reminder-field">
            <label className="font-medium">Nama batch</label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="mis. Batch Senin & Kamis"
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Dipakai buat semua client/rider yang dipilih di bawah — kalau mau label beda per
              client, submit terpisah.
            </p>
          </div>
          <div className="reminder-field reminder-picker">
            <label className="font-medium">
              Client{" "}
              <span className="font-normal text-muted-foreground">
                (bisa pilih lebih dari satu)
              </span>
            </label>
            <input
              value={clientSearch}
              onChange={(e) => setClientSearch(e.target.value)}
              placeholder="Cari client…"
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-xs"
            />
            <div className="mt-1 max-h-32 overflow-y-auto rounded-md border border-border divide-y divide-border">
              {visibleClients.length === 0 ? (
                <p className="p-2 text-xs text-muted-foreground">Tidak ada match</p>
              ) : (
                visibleClients.map((c) => (
                  <label
                    key={c.id}
                    className="flex items-center gap-2 px-2 py-1.5 text-xs cursor-pointer hover:bg-muted/50"
                  >
                    <input
                      type="checkbox"
                      checked={clientIds.includes(c.id)}
                      onChange={() => toggleClient(c.id)}
                    />
                    {c.name}
                  </label>
                ))
              )}
            </div>
            {clientIds.length > 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                <span className="reminder-selection-chip">{clientIds.length} client dipilih</span>
              </p>
            )}
          </div>
          <div className="reminder-field reminder-picker">
            <label className="font-medium">
              Rider{" "}
              <span className="font-normal text-muted-foreground">
                (opsional — buat reminder khusus rider tertentu, bisa pilih lebih dari satu)
              </span>
            </label>
            <input
              value={riderSearch}
              onChange={(e) => setRiderSearch(e.target.value)}
              placeholder="Cari nama / kode rider…"
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-xs"
            />
            <div className="mt-1 max-h-32 overflow-y-auto rounded-md border border-border divide-y divide-border">
              {riderSearch.trim() === "" ? (
                <p className="p-2 text-xs text-muted-foreground">
                  Ketik buat cari rider ({riders.length} total)
                </p>
              ) : visibleRiders.length === 0 ? (
                <p className="p-2 text-xs text-muted-foreground">Tidak ada match</p>
              ) : (
                visibleRiders.slice(0, 50).map((r) => (
                  <label
                    key={r.id}
                    className="flex items-center gap-2 px-2 py-1.5 text-xs cursor-pointer hover:bg-muted/50"
                  >
                    <input
                      type="checkbox"
                      checked={riderIds.includes(r.id)}
                      onChange={() => toggleRider(r.id)}
                    />
                    {r.full_name} ({r.employee_id})
                  </label>
                ))
              )}
            </div>
            {riderIds.length > 0 && (
              <p className="text-xs text-muted-foreground mt-1"><span className="reminder-selection-chip">{riderIds.length} rider dipilih</span></p>
            )}
          </div>
          <div className="reminder-field reminder-weekdays">
            <label className="font-medium">Hari kirim reminder</label>
            <p className="text-xs text-muted-foreground mt-0.5">Pilih hari ketika pengingat harus muncul ke tim.</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {WEEKDAYS.map((name, d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleDay(d)}
                  className={`reminder-weekday px-2.5 py-1 rounded text-xs border ${weekdays.includes(d) ? "bg-primary text-primary-foreground border-primary" : "border-border"}`}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
          {clientIds.length > 0 && (
            <div className="reminder-period-panel rounded-md border border-border p-3">
              <label className="flex items-center gap-2 font-medium cursor-pointer">
                <input type="checkbox" checked={periodOn} onChange={(e) => setPeriodOn(e.target.checked)} />
                Periode perhitungan payroll custom
              </label>
              <p className="text-xs text-muted-foreground mt-1">
                Kosongin kalau client ini mingguan Senin–Minggu biasa. Isi kalau siklusnya beda (mis.
                Selasa–Kamis) — client dengan 2x gajian seminggu tinggal bikin 2 jadwal terpisah dengan
                periode masing-masing (contoh Wicked Pies: Selasa–Kamis & Jumat–Senin).
              </p>
              {periodOn && (
                <div className="mt-2 flex items-center gap-2 text-xs">
                  <select
                    value={periodStartWeekday}
                    onChange={(e) => setPeriodStartWeekday(Number(e.target.value))}
                    className="rounded-md border border-border bg-background px-2 py-1.5"
                  >
                    {WEEKDAYS.map((name, d) => (
                      <option key={d} value={d}>{name}</option>
                    ))}
                  </select>
                  <span className="text-muted-foreground">sampai</span>
                  <select
                    value={periodEndWeekday}
                    onChange={(e) => setPeriodEndWeekday(Number(e.target.value))}
                    className="rounded-md border border-border bg-background px-2 py-1.5"
                  >
                    {WEEKDAYS.map((name, d) => (
                      <option key={d} value={d}>{name}</option>
                    ))}
                  </select>
                </div>
              )}
              {periodOn && (
                <label className="flex items-start gap-2 mt-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={closeSameDay}
                    onChange={(e) => setCloseSameDay(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span className="text-xs">
                    <span className="font-medium">Tutup di hari yang sama</span>{" "}
                    <span className="text-muted-foreground">
                      — dihitung PAS di hari terakhir periode ({WEEKDAYS[periodEndWeekday]}), bukan besoknya.
                      Cuma aman kalau ada cutoff operasional reliable (mis. semua kiriman hari itu udah
                      pasti selesai jam 17:00 WIB, sama jamnya kayak cron sore). Kalau ragu, biarin OFF.
                    </span>
                  </span>
                </label>
              )}
            </div>
          )}
        </div>
        <div className="reminder-modal-footer flex justify-end gap-2">
          <button onClick={onClose} className="reminder-cancel-button px-3 py-1.5 text-sm rounded border border-border">
            Batal
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="reminder-save-button px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground disabled:opacity-50"
          >
            {saving
              ? "Menyimpan…"
              : `Simpan${clientIds.length + riderIds.length > 1 ? ` (${clientIds.length + riderIds.length} jadwal)` : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}
