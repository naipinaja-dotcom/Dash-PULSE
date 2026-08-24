import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

export interface ClassifyResult {
  clientId: string;
  hub: string | null;
  deliveryCount: number;
  returnCount: number;
  unclassifiedCount: number;
  unclassifiedSamples: { sender: string | null; receiver: string | null }[];
}

// Supabase/PostgREST batesin 1000 baris per request secara default —
// kalau ga di-paginate, client yang datanya ribuan bisa keitung salah.
async function fetchAllSenderReceiver(clientId: string) {
  const pageSize = 1000;
  let from = 0;
  const rows: { sender_name: string | null; receiver_name: string | null }[] = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await sb
      .from("delivery_records")
      .select("sender_name, receiver_name")
      .eq("client_id", clientId)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

const normName = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

// Cari titik pusat (hub) per client secara otomatis — Sender Name yang
// paling sering muncul — lalu klasifikasi tiap baris & simpan ke DB.
// Adaptif per client, tidak hardcode.
//
// Match sender/receiver ke hub case-insensitive (+ trim). Data CSV sering
// nulis nama gudang beda kapitalisasi antar kolom Sender/Receiver (mis.
// "It's Buah" vs "IT'S BUAH") — dengan exact match (===) yang lama, baris
// Return-nya gak pernah ke-match sama sekali dan diem-diem nyangkut di
// DELIVERY (nilai default), bukan cuma "gak ke-flag" tapi salah dihitung
// selamanya sampai ketauan manual (kejadian di It's Buah).
export async function classifyDeliveryType(clientId: string): Promise<ClassifyResult> {
  const rows = await fetchAllSenderReceiver(clientId);
  if (rows.length === 0) {
    return { clientId, hub: null, deliveryCount: 0, returnCount: 0, unclassifiedCount: 0, unclassifiedSamples: [] };
  }

  const freq = new Map<string, number>();
  const labelOf = new Map<string, string>();
  rows.forEach((r) => {
    if (!r.sender_name) return;
    const key = normName(r.sender_name);
    freq.set(key, (freq.get(key) ?? 0) + 1);
    if (!labelOf.has(key)) labelOf.set(key, r.sender_name);
  });
  let hubKey: string | null = null, hubCount = 0;
  freq.forEach((count, key) => { if (count > hubCount) { hubKey = key; hubCount = count; } });
  const hub = hubKey ? labelOf.get(hubKey)! : null;

  if (!hubKey) {
    return { clientId, hub: null, deliveryCount: 0, returnCount: 0, unclassifiedCount: rows.length, unclassifiedSamples: rows.slice(0, 10).map((r) => ({ sender: r.sender_name, receiver: r.receiver_name })) };
  }

  let deliveryCount = 0, returnCount = 0;
  const unclassifiedSamples: { sender: string | null; receiver: string | null }[] = [];
  rows.forEach((r) => {
    if (normName(r.sender_name) === hubKey) deliveryCount++;
    else if (normName(r.receiver_name) === hubKey) returnCount++;
    else if (unclassifiedSamples.length < 10) unclassifiedSamples.push({ sender: r.sender_name, receiver: r.receiver_name });
  });
  const unclassifiedCount = rows.length - deliveryCount - returnCount;

  // Tulis ke DB — RETURN dulu baru DELIVERY, biar kalau kebetulan sender
  // DAN receiver sama-sama = hub (data ganjil), yang menang tetap DELIVERY.
  // ilike = case-insensitive exact match (gak ada wildcard di `hub`).
  await sb.from("delivery_records").update({ delivery_type: "RETURN" }).eq("client_id", clientId).ilike("receiver_name", hub);
  await sb.from("delivery_records").update({ delivery_type: "DELIVERY" }).eq("client_id", clientId).ilike("sender_name", hub);

  return { clientId, hub, deliveryCount, returnCount, unclassifiedCount, unclassifiedSamples };
}

export async function classifyAllClients(clientIds: string[]): Promise<ClassifyResult[]> {
  const results: ClassifyResult[] = [];
  for (const id of clientIds) {
    results.push(await classifyDeliveryType(id));
  }
  return results;
}
