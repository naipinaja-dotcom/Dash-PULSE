import { supabase } from "@/integrations/supabase/client";
import { resolveOrCreateRiders } from "@/lib/rider-lookup";
import type { LiveDeliveryRow } from "@/lib/api/live-fee-deliveries.functions";

// Simpan/upsert baris pengiriman live (dari mgmt API) ke delivery_records.
// Dipakai oleh tombol "Sync ke Database" di menu Clients (dialog edit) & di
// halaman Hitung Fee. Perilaku ikut pola upload manual (admin.upload.tsx):
//   - cuma status COMPLETED & FAILED yang disimpan (transien dibuang)
//   - rider di-resolve/auto-create dari driver_code
//   - dedup by dash_delivery_id → baris lama ditimpa (refresh), idempotent
export interface SyncResult {
  total: number;
  usable: number;
  dropped: number;
  inserted: number;
  overwritten: number;
  ridersCreated: number;
}

const ALLOWED_STATUSES = new Set(["COMPLETED", "FAILED"]);

// `client` opsional buat caller server-only (cron live-fee-sync) tanpa sesi
// admin login — pakai getSupabaseAdmin() (service role, bypass RLS) di situ.
// Default anon `supabase` biar caller browser yang ada sekarang gak berubah.
export async function upsertLiveDeliveries(
  clientId: string,
  rows: LiveDeliveryRow[],
  label: string,
  feeByDashId?: Map<string, number>, // fee hasil hitung per dash_delivery_id
  client: typeof supabase = supabase,
): Promise<SyncResult> {
  // Record tanpa ID upstream stabil tidak boleh disimpan: ia tidak bisa
  // di-refresh/dedup pada sync berikutnya. Dash ID diprioritaskan, lalu
  // provider order ID sebagai fallback.
  const eligible = rows.filter(
    (r) =>
      ALLOWED_STATUSES.has(
        String(r.status ?? "")
          .trim()
          .toUpperCase(),
      ) && !!(r.dash_delivery_id?.trim() || r.provider_order_id?.trim()),
  );
  const byExternalId = new Map<string, LiveDeliveryRow>();
  for (const row of eligible) {
    const key = row.dash_delivery_id?.trim()
      ? `dash:${row.dash_delivery_id.trim()}`
      : `provider:${row.provider_order_id!.trim()}`;
    byExternalId.set(key, row);
  }
  const usable = [...byExternalId.values()];
  const dropped = rows.length - usable.length;
  const result: SyncResult = {
    total: rows.length,
    usable: usable.length,
    dropped,
    inserted: 0,
    overwritten: 0,
    ridersCreated: 0,
  };
  if (usable.length === 0) return result;

  // 1. Resolve/create rider dari kode mitra.
  const namesByCode: Record<string, string> = {};
  usable.forEach((r) => {
    if (r.driver_code && r.driver_name) namesByCode[r.driver_code] = r.driver_name;
  });
  const { map: riderMap, createdCodes } = await resolveOrCreateRiders(
    usable.map((r) => r.driver_code),
    namesByCode,
    client,
  );
  result.ridersCreated = createdCodes.length;

  // 2. Batch penanda sumber.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: batch, error: bErr } = await (client as any)
    .from("upload_batches")
    .insert({ kind: "delivery", client_id: clientId, filename: label, row_count: usable.length })
    .select()
    .single();
  if (bErr) throw bErr;

  // 3. Payload delivery_records.
  const payloads = usable.map((r) => ({
    batch_id: batch.id,
    client_id: clientId,
    rider_id: r.driver_code ? (riderMap.get(r.driver_code) ?? null) : null,
    driver_code: r.driver_code,
    status: r.status,
    dash_delivery_id: r.dash_delivery_id,
    provider_order_id: r.provider_order_id,
    delivery_date: r.delivery_date,
    awb: r.awb,
    district: r.district,
    city: r.city,
    distance_km: r.distance_km,
    weight_kg: r.weight_kg,
    destination_address: r.destination_address,
    destination_lat: r.destination_lat,
    destination_lng: r.destination_lng,
    sender_name: r.sender_name,
    receiver_name: r.receiver_name,
    service_type: r.service_type,
    delivery_type: r.delivery_type ?? "DELIVERY",
    fee: (r.dash_delivery_id && feeByDashId?.get(r.dash_delivery_id)) || 0,
  }));

  // Delete + insert dijalankan sebagai SATU transaksi di Postgres. Kalau
  // jaringan/insert gagal, data sync sebelumnya tetap utuh; retry kemudian
  // menggantikannya, tidak menambahkan baris kedua.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (client as any).rpc("replace_live_deliveries", {
    p_client_id: clientId,
    p_rows: payloads,
  });
  if (error) throw error;
  const counts = Array.isArray(data) ? data[0] : data;
  result.overwritten = Number(counts?.overwritten) || 0;
  result.inserted = Number(counts?.inserted) || 0;

  return result;
}
