import { supabase } from "@/integrations/supabase/client";

// Rider berdiri sendiri (identitasnya = kode MTR/employee_id). Client TIDAK
// ditempel ke rider — itu nempel per delivery/attendance row (1 rider bisa
// jalan untuk banyak client). Fungsi ini nyari rider yang sudah ada by kode;
// kode yang belum terdaftar otomatis dibikinkan rider baru (tanpa client_id).
// `client` opsional buat caller server-only (cron/workflow) tanpa sesi admin
// login — sama pola dengan resolveRiderIdentities di bawah.
export async function resolveOrCreateRiders(
  codes: (string | null | undefined)[],
  namesByCode: Record<string, string> = {},
  client: typeof supabase = supabase,
): Promise<{ map: Map<string, string>; createdCodes: string[] }> {
  const uniqueCodes = Array.from(new Set(codes.filter((c): c is string => !!c && c.trim() !== "").map((c) => c.trim())));
  const map = new Map<string, string>();
  if (uniqueCodes.length === 0) return { map, createdCodes: [] };

  const { data: existing, error: selErr } = await client
    .from("riders")
    .select("id, employee_id")
    .in("employee_id", uniqueCodes);
  if (selErr) throw selErr;
  (existing ?? []).forEach((r) => map.set(r.employee_id, r.id));

  const missing = uniqueCodes.filter((c) => !map.has(c));
  if (missing.length === 0) return { map, createdCodes: [] };

  const toInsert = missing.map((code) => ({
    employee_id: code,
    full_name: namesByCode[code]?.trim() || code,
    status: "active" as const,
  }));
  const { data: inserted, error: insErr } = await client.from("riders").insert(toInsert).select("id, employee_id");
  if (insErr) throw insErr;
  (inserted ?? []).forEach((r) => map.set(r.employee_id, r.id));
  return { map, createdCodes: missing };
}

export interface RiderIdentityRow {
  rider_id?: string | null;
  driver_code?: string | null;
}

export interface RiderIdentity {
  id: string;
  full_name: string;
  employee_id: string;
  client_id?: string | null;
}

// Sebagian delivery_records/attendance_logs bisa punya rider_id NULL (baris lama
// sebelum resolveOrCreateRiders dipasang, atau match sempat gagal) walau
// driver_code (kode mitra)-nya valid. Fungsi ini nyari identitas rider dari
// KEDUANYA — rider_id kalau ada, fallback ke driver_code→employee_id kalau
// nggak — biar baris itu tetap kehitung/ketemu namanya, bukan diam-diam ke-skip.
// Dipakai baca (Hitung Fee, Payroll Run), BUKAN bikin rider baru (beda dari
// resolveOrCreateRiders yang khusus upload).
// `client` opsional buat caller server-only (cron/workflow) yang gak punya
// session admin login — supabase (anon) di atas dipakai default biar semua
// caller browser yang ada sekarang gak berubah perilakunya.
export async function resolveRiderIdentities(
  rows: RiderIdentityRow[],
  client: typeof supabase = supabase,
): Promise<{
  byId: Map<string, RiderIdentity>;
  byCode: Map<string, RiderIdentity>;
  resolvedIdOf: (row: RiderIdentityRow) => string | null;
  nameOf: (row: RiderIdentityRow) => string;
}> {
  const ids = [...new Set(rows.map((r) => r.rider_id).filter((v): v is string => !!v))];
  const codes = [...new Set(rows.filter((r) => !r.rider_id && r.driver_code).map((r) => r.driver_code as string))];
  const byId = new Map<string, RiderIdentity>();
  const byCode = new Map<string, RiderIdentity>();

  const queries: Promise<{ data: RiderIdentity[] | null }>[] = [];
  if (ids.length > 0) queries.push(client.from("riders").select("id, full_name, employee_id, client_id").in("id", ids) as any);
  if (codes.length > 0) queries.push(client.from("riders").select("id, full_name, employee_id, client_id").in("employee_id", codes) as any);
  const results = await Promise.all(queries);
  for (const res of results) {
    for (const r of res.data ?? []) {
      byId.set(r.id, r);
      byCode.set(r.employee_id, r);
    }
  }

  const resolvedIdOf = (row: RiderIdentityRow) => row.rider_id || (row.driver_code ? byCode.get(row.driver_code)?.id ?? null : null);
  const nameOf = (row: RiderIdentityRow) =>
    (row.rider_id && byId.get(row.rider_id)?.full_name) ||
    (row.driver_code && byCode.get(row.driver_code)?.full_name) ||
    row.driver_code ||
    "(tanpa rider)";

  return { byId, byCode, resolvedIdOf, nameOf };
}
