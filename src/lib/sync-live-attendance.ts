import { supabase } from "@/integrations/supabase/client";
import { resolveOrCreateRiders } from "@/lib/rider-lookup";
import type { LiveAttendanceRow } from "@/lib/api/live-fee-attendance.functions";

// Simpan/overwrite absensi live (dari logbook API) ke attendance_logs.
// Dipakai tombol "Sync ke Database" di Hitung Fee (cabang attendance).
// Overwrite per periode: hapus attendance_logs client di [from,to] lalu insert
// ulang — idempotent, aman dijalankan berulang. Simpan PER-SHIFT (rider bisa
// punya >1 shift/hari; tabel tidak punya unique key rider+hari).
export interface AttSyncResult {
  total: number;
  inserted: number;
  ridersCreated: number;
}

// `client` opsional buat caller server-only (cron live-fee-sync) tanpa sesi
// admin login — pakai getSupabaseAdmin() (service role, bypass RLS) di situ.
// Default anon `supabase` biar caller browser yang ada sekarang gak berubah.
export async function upsertLiveAttendance(
  clientId: string,
  rows: LiveAttendanceRow[],
  from: string,
  to: string,
  label: string,
  fees: number[] = [], // fee hasil hitung, sejajar dengan `rows` (index-aligned)
  client: typeof supabase = supabase,
): Promise<AttSyncResult> {
  const result: AttSyncResult = { total: rows.length, inserted: 0, ridersCreated: 0 };
  if (rows.length === 0) return result;

  // 1. Resolve/create rider dari kode mitra.
  const namesByCode: Record<string, string> = {};
  rows.forEach((r) => {
    if (r.driver_code && r.driver_name) namesByCode[r.driver_code] = r.driver_name;
  });
  const { map: riderMap, createdCodes } = await resolveOrCreateRiders(
    rows.map((r) => r.driver_code),
    namesByCode,
    client,
  );
  result.ridersCreated = createdCodes.length;

  // 2. Batch penanda sumber.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: batch, error: bErr } = await (client as any)
    .from("upload_batches")
    .insert({ kind: "attendance", client_id: clientId, filename: label, row_count: rows.length })
    .select()
    .single();
  if (bErr) throw bErr;

  // 3. OVERWRITE: hapus absensi lama client ini di periode [from,to].
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: delErr } = await (client as any)
    .from("attendance_logs")
    .delete()
    .eq("client_id", clientId)
    .gte("log_date", from)
    .lte("log_date", to);
  if (delErr) throw delErr;

  // 4. Insert per-shift, dengan fee hasil hitung (kalau diberikan).
  const payloads = rows.map((r, i) => ({
    batch_id: batch.id,
    client_id: clientId,
    rider_id: r.driver_code ? (riderMap.get(r.driver_code) ?? null) : null,
    driver_code: r.driver_code,
    client_name: r.client_name,
    pitstop_name: r.pitstop_name,
    log_date: r.log_date,
    clock_in: r.clock_in,
    clock_out: r.clock_out,
    duration_minutes: r.duration_minutes,
    is_late: r.is_late,
    is_absent: r.is_absent,
    fee: Number(fees[i]) || 0,
  }));
  for (let i = 0; i < payloads.length; i += 200) {
    const chunk = payloads.slice(i, i + 200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (client as any).from("attendance_logs").insert(chunk);
    if (error) throw error;
    result.inserted += chunk.length;
  }

  return result;
}
