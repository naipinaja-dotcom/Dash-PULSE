// Kategori 2 — Per Kehadiran. Dipecah dari pricing-form.tsx.
// v2: delivery_component toggle menggantikan kategori "Kombinasi" lama.
import { parseRupiah } from "@/lib/format";
import { AddRowBtn, FieldLabel, RupiahInput, Td, TableShell, TextInput, TimeInput, Th, RowDeleteBtn, ToggleBlock } from "./shared";
import {
  AttendanceDeliveryCompFields,
  buildDeliveryCompConfig,
  emptyDeliveryCompState,
  loadDeliveryCompState,
  type AttendanceDeliveryCompState,
} from "./attendance-delivery-comp";

export type { AttendanceDeliveryCompState };

// 1 shift = jendela jam clock-in tertentu + tarif SENDIRI. Pure penentu
// tarif/jam kerja — insentif/ontime TETAP dari tabel Insentif di bawah
// (satu sumber kebenaran, tidak ada penentuan ontime kedua di sini).
// Opsional — kalau kosong, skema pakai 1 tarif flat seperti sebelumnya
// (field full_fee/standard_hours di atas jadi fallback-nya).
export interface ShiftRow {
  label: string;
  start_time: string; // "04:00"
  end_time: string;   // "09:00"
  late_after: string; // "06:10" — clock-in lewat ini = telat (ontime bonus hangus). Kosong = pakai flag data.
  full_fee: string;
  standard_hours: string;
}

export function emptyShiftRow(n: number): ShiftRow {
  return { label: `Shift ${n}`, start_time: "", end_time: "", late_after: "", full_fee: "100000", standard_hours: "8" };
}

export interface AttendanceState {
  full_fee: string;
  standard_hours: string; // ditampilkan dalam jam, disimpan sebagai menit di config
  overtimeOn: boolean;
  overtime_rate_per_hour: string;
  incentives: { label: string; amount: string; condition: "always" | "ontime_only" }[];
  shiftsOn: boolean;
  shifts: ShiftRow[];
  deliveryCompOn: boolean;
  deliveryComp: AttendanceDeliveryCompState;
}

export function emptyAttendanceState(): AttendanceState {
  return {
    full_fee: "100000",
    standard_hours: "8",
    overtimeOn: false,
    overtime_rate_per_hour: "0",
    incentives: [{ label: "Insentif Ontime", amount: "40000", condition: "ontime_only" }],
    shiftsOn: false,
    shifts: [],
    deliveryCompOn: false,
    deliveryComp: emptyDeliveryCompState(),
  };
}

export function buildAttendanceConfig(a: AttendanceState): Record<string, unknown> {
  return {
    full_fee: parseRupiah(a.full_fee),
    standard_minutes: (Number(a.standard_hours) || 0) * 60,
    overtime: a.overtimeOn ? { enabled: true, rate_per_hour: parseRupiah(a.overtime_rate_per_hour) } : null,
    incentives: a.incentives
      .filter((c) => c.label.trim())
      .map((c) => ({ label: c.label.trim(), amount: parseRupiah(c.amount), condition: c.condition })),
    shifts: a.shiftsOn
      ? a.shifts.filter((s) => s.start_time && s.end_time).map((s, i) => ({
          shift_number: i + 1, label: s.label.trim() || `Shift ${i + 1}`,
          start_time: s.start_time, end_time: s.end_time,
          late_after: s.late_after || undefined,
          full_fee: parseRupiah(s.full_fee), standard_minutes: (Number(s.standard_hours) || 0) * 60,
        }))
      : [],
    delivery_component: a.deliveryCompOn ? buildDeliveryCompConfig(a.deliveryComp) : null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function loadAttendanceState(c: any): AttendanceState {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const shifts: any[] = c.shifts ?? [];
  return {
    full_fee: String(c.full_fee ?? ""),
    standard_hours: String((Number(c.standard_minutes) || 0) / 60 || ""),
    overtimeOn: !!c.overtime?.enabled,
    overtime_rate_per_hour: String(c.overtime?.rate_per_hour ?? "0"),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    incentives: (c.incentives ?? []).map((x: any) => ({ label: x.label ?? "", amount: String(x.amount ?? ""), condition: x.condition === "ontime_only" ? "ontime_only" : "always" })),
    shiftsOn: shifts.length > 0,
    shifts: shifts.map((s) => ({
      label: s.label ?? "", start_time: s.start_time ?? "", end_time: s.end_time ?? "",
      late_after: s.late_after ?? "",
      full_fee: String(s.full_fee ?? ""), standard_hours: String((Number(s.standard_minutes) || 0) / 60 || ""),
    })),
    deliveryCompOn: !!c.delivery_component?.enabled,
    deliveryComp: loadDeliveryCompState(c.delivery_component ?? null),
  };
}

export function AttendanceFields({ value, onChange }: { value: AttendanceState; onChange: (v: AttendanceState) => void }) {
  const patch = (p: Partial<AttendanceState>) => onChange({ ...value, ...p });

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-primary-border bg-primary-soft px-3.5 py-2.5 text-xs text-primary-soft-foreground">
        Rumus: (fee penuh × proporsi jam kerja) {value.overtimeOn ? "+ lembur " : ""}+ insentif (nominal ditentuin di sini, data absensi cuma dipakai cek syarat — mis. OTP=ONTIME).
        {value.shiftsOn && " Shift Configuration AKTIF di bawah — tarif/jam standar di sini cuma FALLBACK kalau clock-in rider di luar semua jendela shift. Insentif (termasuk ontime) SELALU dari tabel Insentif di bawah, berlaku sama buat semua shift."}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <FieldLabel>{value.shiftsOn ? "Fee Penuh (Fallback, Rp)" : "Fee Penuh per Shift (Rp)"}</FieldLabel>
          <RupiahInput value={value.full_fee} onChange={(v) => patch({ full_fee: v })} />
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel>{value.shiftsOn ? "Jam Standar (Fallback)" : "Jam Standar per Shift"}</FieldLabel>
          <TextInput type="number" value={value.standard_hours} onChange={(e) => patch({ standard_hours: e.target.value })} placeholder="8" />
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground -mt-2">
        {value.shiftsOn
          ? "Cuma kepakai kalau clock-in rider TIDAK cocok ke shift manapun di bawah."
          : "Kerja kurang dari jam standar dibayar proporsional. Kerja pas/lebih = fee penuh (kecuali lembur dinyalain di bawah)."}
      </p>

      <ToggleBlock
        label="Lembur (bayar kelebihan jam kerja)"
        hint="Kalau mati, kerja lebih dari jam standar tetap mentok di fee penuh (tidak ada tambahan)."
        on={value.overtimeOn}
        onToggle={(on) => patch({ overtimeOn: on })}
      >
        <div className="max-w-xs">
          <FieldLabel>Tarif Lembur per Jam (Rp)</FieldLabel>
          <RupiahInput value={value.overtime_rate_per_hour} onChange={(v) => patch({ overtime_rate_per_hour: v })} />
        </div>
      </ToggleBlock>

      <div>
        <p className="text-xs font-medium text-muted-foreground mb-2">Insentif</p>
        <TableShell head={<>
          <Th>Nama Insentif</Th>
          <Th className="w-36">Jumlah (Rp)</Th>
          <Th className="w-44">Syarat Cair</Th>
          <Th className="w-10" />
        </>}>
          {value.incentives.map((c, i) => (
            <tr key={i} className="border-t border-border/60">
              <Td><TextInput value={c.label} placeholder="cth: Insentif Ontime" onChange={(e) => patch({ incentives: value.incentives.map((x, idx) => (idx === i ? { ...x, label: e.target.value } : x)) })} /></Td>
              <Td><RupiahInput value={c.amount} onChange={(v) => patch({ incentives: value.incentives.map((x, idx) => (idx === i ? { ...x, amount: v } : x)) })} /></Td>
              <Td>
                <select
                  value={c.condition}
                  onChange={(e) => patch({ incentives: value.incentives.map((x, idx) => (idx === i ? { ...x, condition: e.target.value as "always" | "ontime_only" } : x)) })}
                  className="w-full text-sm rounded-md border border-border bg-card px-2 py-1.5"
                >
                  <option value="always">Selalu (hari kerja)</option>
                  <option value="ontime_only">Cuma kalau ONTIME</option>
                </select>
              </Td>
              <Td className="text-center"><RowDeleteBtn onClick={() => patch({ incentives: value.incentives.filter((_, idx) => idx !== i) })} /></Td>
            </tr>
          ))}
        </TableShell>
        <AddRowBtn onClick={() => patch({ incentives: [...value.incentives, { label: "", amount: "", condition: "always" }] })}>Tambah Insentif</AddRowBtn>
        <p className="text-[11px] text-muted-foreground mt-1.5">"Cuma kalau ONTIME" itu biner — hari LATE dapet Rp0 buat insentif ini, ga ada setengah-setengah.</p>
      </div>

      <ToggleBlock
        label="Shift Configuration (tarif beda per jam clock-in)"
        hint="Buat client dengan beberapa shift beda tarif — rider otomatis kedeteksi dari jam clock-in. Insentif/ontime tetap dari tabel di atas."
        on={value.shiftsOn}
        onToggle={(on) => patch({ shiftsOn: on, shifts: on && value.shifts.length === 0 ? [emptyShiftRow(1)] : value.shifts })}
      >
        <div className="space-y-3">
          {value.shifts.map((s, i) => (
            <div key={i} className="rounded-md border border-border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <TextInput value={s.label} placeholder={`Shift ${i + 1}`}
                  onChange={(e) => patch({ shifts: value.shifts.map((x, idx) => (idx === i ? { ...x, label: e.target.value } : x)) })}
                  className="max-w-[180px] font-medium" />
                <RowDeleteBtn onClick={() => patch({ shifts: value.shifts.filter((_, idx) => idx !== i) })} />
              </div>
              <div className="grid grid-cols-5 gap-2">
                <div>
                  <FieldLabel>Clock-in Dari</FieldLabel>
                  <TimeInput value={s.start_time} onChange={(v) => patch({ shifts: value.shifts.map((x, idx) => (idx === i ? { ...x, start_time: v } : x)) })} />
                </div>
                <div>
                  <FieldLabel>Sampai (eksklusif)</FieldLabel>
                  <TimeInput value={s.end_time} onChange={(v) => patch({ shifts: value.shifts.map((x, idx) => (idx === i ? { ...x, end_time: v } : x)) })} />
                </div>
                <div>
                  <FieldLabel>Batas Ontime</FieldLabel>
                  <TimeInput value={s.late_after} onChange={(v) => patch({ shifts: value.shifts.map((x, idx) => (idx === i ? { ...x, late_after: v } : x)) })} />
                </div>
                <div>
                  <FieldLabel>Fee Penuh (Rp)</FieldLabel>
                  <RupiahInput value={s.full_fee} onChange={(v) => patch({ shifts: value.shifts.map((x, idx) => (idx === i ? { ...x, full_fee: v } : x)) })} />
                </div>
                <div>
                  <FieldLabel>Jam Standar</FieldLabel>
                  <TextInput type="number" value={s.standard_hours} onChange={(e) => patch({ shifts: value.shifts.map((x, idx) => (idx === i ? { ...x, standard_hours: e.target.value } : x)) })} />
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                "Batas Ontime" opsional — clock-in lewat jam ini = telat, insentif ontime-only hangus.
                Kosongkan kalau telat ditentukan dari data (kolom OTP upload). Jendela "Clock-in Dari/Sampai"
                boleh lebih lebar dari batas ontime (mis. pagi 03:00–12:00, batas ontime 06:10).
              </p>
            </div>
          ))}
          <AddRowBtn onClick={() => patch({ shifts: [...value.shifts, emptyShiftRow(value.shifts.length + 1)] })}>Tambah Shift</AddRowBtn>
        </div>
      </ToggleBlock>

      <ToggleBlock
        label="Komponen per kiriman (gabung delivery + attendance)"
        hint="Tambah fee per pengiriman ke fee absensi harian, dari data pengiriman di rentang yang sama."
        on={value.deliveryCompOn}
        onToggle={(on) => patch({ deliveryCompOn: on })}
      >
        <AttendanceDeliveryCompFields
          value={value.deliveryComp}
          onChange={(v) => patch({ deliveryComp: v })}
        />
      </ToggleBlock>
    </div>
  );
}
