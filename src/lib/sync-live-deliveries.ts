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

// Fee final 1 baris: feeByDashId (caller yang BENERAN ngitung, mis.
// syncOneClient) menang kalau ada; kalau enggak, PERTAHANKAN fee yang udah
// tersimpan sebelumnya (caller raw-data-only, mis. "Tarik dari API" di Cek
// Data) — bukan reset ke 0. `r.dash_delivery_id && ...` sengaja TIDAK dipakai
// buat nentuin fallback (string kosong itu falsy tapi bukan nullish, bisa
// lolos jadi fee="" kalau asal pakai `??` berantai) — key-nya dibangun
// eksplisit sama persis pola byExternalId di atas.
export function resolveFee(
  r: LiveDeliveryRow,
  feeByDashId: Map<string, number> | undefined,
  existingFeeByExternalId: Map<string, number>,
): number {
  const dashId = r.dash_delivery_id?.trim();
  if (dashId) {
    const fresh = feeByDashId?.get(dashId);
    if (fresh !== undefined) return fresh;
  }
  const key = dashId ? `dash:${dashId}` : `provider:${r.provider_order_id!.trim()}`;
  return existingFeeByExternalId.get(key) ?? 0;
}

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

  // replace_live_deliveries (RPC) itu DELETE+INSERT penuh per baris (match by
  // dash_delivery_id/provider_order_id) — bukan upsert parsial, jadi kolom
  // `fee` row LAMA yang gak ketimpa feeByDashId bakal hilang diam-diam
  // (default ke 0) kalau gak di-preserve manual di sini. Caller yang SENGAJA
  // gak ngitung fee (mis. "Tarik dari API" di Cek Data — raw data doang,
  // lihat komentar syncFromApi di admin.data-check.tsx) sebelumnya nge-reset
  // fee baris yang UDAH ke-Hitung-Fee/di-commit ke 0 kalau date range-nya
  // overlap periode yang udah dihitung — payroll yang udah di-Finalize/
  // Publish ikut keikut nol pas di-Generate Ulang (bug nyata: GORECA).
  // feeByDashId (kalau caller ngasih, mis. syncOneClient/"Tarik & Sync dari
  // API" di Hitung Fee) TETAP menang — itu representasi fee TERBARU yang
  // emang mau ditulis ulang.
  const existingFeeByExternalId = new Map<string, number>();
  const dashIds = usable.map((r) => r.dash_delivery_id?.trim()).filter((v): v is string => !!v);
  const providerIds = usable
    .map((r) => r.provider_order_id?.trim())
    .filter((v): v is string => !!v);
  // Dua query terpisah (bukan 1 query .or() string-built) — ID dari mgmt API
  // gak terjamin bebas koma/karakter spesial, jadi aman dari filter PostgREST
  // yang salah parse kalau dipaksa digabung jadi satu string.
  const existingRowsQueries = [
    dashIds.length > 0
      ? (client as any)
          .from("delivery_records")
          .select("dash_delivery_id, provider_order_id, fee")
          .eq("client_id", clientId)
          .in("dash_delivery_id", dashIds)
      : null,
    providerIds.length > 0
      ? (client as any)
          .from("delivery_records")
          .select("dash_delivery_id, provider_order_id, fee")
          .eq("client_id", clientId)
          .in("provider_order_id", providerIds)
      : null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ].filter((q): q is any => q !== null);
  const existingResults = await Promise.all(existingRowsQueries);
  for (const { data: existing } of existingResults) {
    for (const r of (existing ?? []) as {
      dash_delivery_id: string | null;
      provider_order_id: string | null;
      fee: number | null;
    }[]) {
      const key = r.dash_delivery_id
        ? `dash:${r.dash_delivery_id}`
        : `provider:${r.provider_order_id}`;
      existingFeeByExternalId.set(key, Number(r.fee) || 0);
    }
  }

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
    fee: resolveFee(r, feeByDashId, existingFeeByExternalId),
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
