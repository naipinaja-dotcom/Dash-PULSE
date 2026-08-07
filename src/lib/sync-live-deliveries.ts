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
  const usable = rows.filter((r) =>
    ALLOWED_STATUSES.has(String(r.status ?? "").trim().toUpperCase()),
  );
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

  // 4. TIMPA: hapus baris lama dengan Dash ID sama (refresh), lalu insert.
  const dashIds = payloads.map((p) => p.dash_delivery_id).filter((v): v is string => !!v);
  for (let i = 0; i < dashIds.length; i += 200) {
    const chunk = dashIds.slice(i, i + 200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error, count } = await (client as any)
      .from("delivery_records")
      .delete({ count: "exact" })
      .in("dash_delivery_id", chunk);
    if (error) throw error;
    result.overwritten += count ?? 0;
  }
  for (let i = 0; i < payloads.length; i += 200) {
    const chunk = payloads.slice(i, i + 200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (client as any).from("delivery_records").insert(chunk);
    if (error) throw error;
    result.inserted += chunk.length;
  }

  return result;
}
