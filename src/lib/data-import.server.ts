import { getSupabaseAdmin } from "./supabase-admin.server";

// ── Types ────────────────────────────────────────────────────────

export interface ImportSource {
  type: "rest_api" | "database";
  /** REST: full URL; DB: postgres:// connection string */
  url: string;
  /** REST: bearer token or API key; DB: unused (embedded in url) */
  authToken?: string;
  /** REST: custom headers; DB: unused */
  headers?: Record<string, string>;
}

interface RawDelivery {
  driver_code: string;
  delivery_date: string; // YYYY-MM-DD
  awb?: string;
  district?: string;
  distance_km?: number;
  weight_kg?: number;
  destination_address?: string;
  sender_name?: string;
  receiver_name?: string;
  service_type?: string;
  status?: string;
  dash_delivery_id?: string;
  provider_order_id?: string;
  delivery_type?: string; // DELIVERY | RETURN
  fee?: number;
  client_name?: string;
}

interface RawAttendance {
  driver_code: string;
  log_date: string; // YYYY-MM-DD
  clock_in?: string; // HH:mm
  clock_out?: string;
  duration_minutes?: number;
  is_late?: boolean;
  is_absent?: boolean;
  fee?: number;
  client_name?: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function deliveryKeys(row: Pick<RawDelivery, "dash_delivery_id" | "provider_order_id">): string[] {
  const keys: string[] = [];
  const dashId = row.dash_delivery_id?.trim();
  const providerId = row.provider_order_id?.trim();
  if (dashId) keys.push(`dash:${dashId}`);
  if (providerId) keys.push(`provider:${providerId}`);
  return keys;
}

function attendanceKey(
  row: Pick<RawAttendance, "client_name" | "driver_code" | "log_date" | "clock_in">,
  clientId?: string | null,
): string {
  // Satu rider boleh punya lebih dari satu shift pada tanggal yang sama.
  // client + clock-in membedakan shift tersebut; client_name dipakai sebagai
  // fallback bila nama client dari sumber belum terdaftar di Dash PULSE.
  const client = clientId ?? row.client_name?.trim() ?? "";
  return `${client}|${row.driver_code?.trim() ?? ""}|${row.log_date}|${row.clock_in ?? ""}`;
}

export interface ImportResult {
  deliveries: { fetched: number; inserted: number; skipped: number };
  attendance: { fetched: number; inserted: number; skipped: number };
  errors: string[];
}

// ── Config ───────────────────────────────────────────────────────

function getSourceConfig(): {
  delivery: ImportSource | null;
  attendance: ImportSource | null;
} {
  const delivType = process.env.IMPORT_DELIVERY_SOURCE_TYPE as "rest_api" | "database" | undefined;
  const delivUrl = process.env.IMPORT_DELIVERY_SOURCE_URL;
  const delivToken = process.env.IMPORT_DELIVERY_AUTH_TOKEN;

  const attType = process.env.IMPORT_ATTENDANCE_SOURCE_TYPE as "rest_api" | "database" | undefined;
  const attUrl = process.env.IMPORT_ATTENDANCE_SOURCE_URL;
  const attToken = process.env.IMPORT_ATTENDANCE_AUTH_TOKEN;

  return {
    delivery:
      delivType && delivUrl ? { type: delivType, url: delivUrl, authToken: delivToken } : null,
    attendance: attType && attUrl ? { type: attType, url: attUrl, authToken: attToken } : null,
  };
}

// ── Fetchers ─────────────────────────────────────────────────────

async function fetchFromRestApi<T>(source: ImportSource, dateParam?: string): Promise<T[]> {
  const url = new URL(source.url);
  if (dateParam) url.searchParams.set("date", dateParam);

  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(source.headers ?? {}),
  };
  if (source.authToken) headers["Authorization"] = `Bearer ${source.authToken}`;

  const res = await fetch(url.toString(), { headers });
  if (!res.ok) throw new Error(`REST API ${res.status}: ${await res.text()}`);

  const json = await res.json();
  // Support both { data: [...] } and plain [...]
  return Array.isArray(json) ? json : Array.isArray(json.data) ? json.data : [];
}

async function fetchFromDatabase<T>(
  source: ImportSource,
  query: string,
  values: unknown[] = [],
): Promise<T[]> {
  // Dynamic import — pg is only needed when source type is "database".
  // It must be installed on the server: `npm i pg` (not bundled for client).
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: source.url });
  await client.connect();
  try {
    const result = await client.query(query, values);
    return result.rows as T[];
  } finally {
    await client.end();
  }
}

// ── Rider resolution (server-side) ──────────────────────────────

async function resolveRiders(codes: string[]): Promise<Map<string, string>> {
  const sb = getSupabaseAdmin();
  const unique = [...new Set(codes.filter(Boolean).map((c) => c.trim()))];
  const map = new Map<string, string>();
  if (unique.length === 0) return map;

  // Fetch existing
  const { data: existing } = await sb
    .from("riders")
    .select("id, employee_id")
    .in("employee_id", unique);
  (existing ?? []).forEach((r: any) => map.set(r.employee_id, r.id));

  // Create missing
  const missing = unique.filter((c) => !map.has(c));
  if (missing.length > 0) {
    const toInsert = missing.map((code) => ({
      employee_id: code,
      full_name: code,
      status: "active" as const,
    }));
    const { data: inserted } = await sb.from("riders").insert(toInsert).select("id, employee_id");
    (inserted ?? []).forEach((r: any) => map.set(r.employee_id, r.id));
  }

  return map;
}

// ── Client resolution ────────────────────────────────────────────

async function resolveClients(names: string[]): Promise<Map<string, string>> {
  const sb = getSupabaseAdmin();
  const unique = [...new Set(names.filter(Boolean).map((n) => n.trim()))];
  const map = new Map<string, string>();
  if (unique.length === 0) return map;

  const { data: existing } = await sb.from("clients").select("id, name").in("name", unique);
  (existing ?? []).forEach((c: any) => map.set(c.name, c.id));
  return map;
}

// ── Main import logic ────────────────────────────────────────────

export function verifyImportSecret(header: string | null): boolean {
  const secret = process.env.DATA_IMPORT_SECRET;
  if (!secret) return false;
  return header === secret;
}

/**
 * Import yesterday's delivery records + attendance from configured external
 * sources. Deduplicates against existing rows in the database.
 */
export async function runDailyImport(targetDate?: string): Promise<ImportResult> {
  const sb = getSupabaseAdmin();
  const result: ImportResult = {
    deliveries: { fetched: 0, inserted: 0, skipped: 0 },
    attendance: { fetched: 0, inserted: 0, skipped: 0 },
    errors: [],
  };

  const config = getSourceConfig();
  // Default: yesterday (WIB = UTC+7)
  const date =
    targetDate ?? new Date(Date.now() + 7 * 3600_000 - 86400_000).toISOString().slice(0, 10);
  if (!DATE_RE.test(date)) throw new Error("Tanggal import harus berformat YYYY-MM-DD");

  // ── 1. Delivery records ────────────────────────────────────────
  if (config.delivery) {
    try {
      let rows: RawDelivery[];
      if (config.delivery.type === "rest_api") {
        rows = await fetchFromRestApi<RawDelivery>(config.delivery, date);
      } else {
        rows = await fetchFromDatabase<RawDelivery>(
          config.delivery,
          "SELECT * FROM deliveries WHERE delivery_date = $1",
          [date],
        );
      }
      result.deliveries.fetched = rows.length;

      if (rows.length > 0) {
        // Resolve riders & clients
        const riderMap = await resolveRiders(rows.map((r) => r.driver_code));
        const clientNames = rows.map((r) => r.client_name).filter(Boolean) as string[];
        const clientMap = await resolveClients(clientNames);

        // Create batch
        const { data: batch } = await sb
          .from("upload_batches" as any)
          .insert({ source: "cron_import", row_count: rows.length })
          .select("id")
          .single();
        const batchId = batch?.id;

        // Check existing by either stable upstream ID. AWB is optional and
        // never determines whether an order can be deduplicated.
        const existingKeys = new Set<string>();
        const { data: existing } = await (sb as any)
          .from("delivery_records")
          .select("dash_delivery_id, provider_order_id")
          .eq("delivery_date", date);
        (existing ?? []).forEach((e: RawDelivery) =>
          deliveryKeys(e).forEach((key) => existingKeys.add(key)),
        );

        // Insert in chunks. Cuma COMPLETED & FAILED yang berguna buat payroll/
        // analytics — status transien kayak PENDING_PICKUP dibuang di sini
        // (gak pernah masuk delivery_records), sama seperti upload manual
        // (lihat admin.upload.tsx).
        const ALLOWED_STATUSES = new Set(["COMPLETED", "FAILED"]);
        const toInsert = rows
          .filter((r) => {
            if (
              !ALLOWED_STATUSES.has(
                String(r.status ?? "")
                  .trim()
                  .toUpperCase(),
              )
            ) {
              result.deliveries.skipped++;
              return false;
            }
            const keys = deliveryKeys(r);
            if (keys.length === 0) {
              result.deliveries.skipped++;
              return false;
            }
            if (keys.some((key) => existingKeys.has(key))) {
              result.deliveries.skipped++;
              return false;
            }
            // Also protects against duplicate rows inside a single source response.
            keys.forEach((key) => existingKeys.add(key));
            return true;
          })
          .map((r) => ({
            batch_id: batchId,
            rider_id: riderMap.get(r.driver_code) ?? null,
            driver_code: r.driver_code,
            client_id: r.client_name ? (clientMap.get(r.client_name) ?? null) : null,
            delivery_date: r.delivery_date,
            awb: r.awb ?? null,
            district: r.district ?? null,
            distance_km: r.distance_km ?? null,
            weight_kg: r.weight_kg ?? null,
            destination_address: r.destination_address ?? null,
            sender_name: r.sender_name ?? null,
            receiver_name: r.receiver_name ?? null,
            service_type: r.service_type ?? null,
            status: r.status ?? null,
            dash_delivery_id: r.dash_delivery_id ?? null,
            provider_order_id: r.provider_order_id ?? null,
            delivery_type: r.delivery_type ?? "DELIVERY",
            fee: r.fee ?? null,
          }));

        for (let i = 0; i < toInsert.length; i += 500) {
          const chunk = toInsert.slice(i, i + 500);
          const { error } = await (sb as any).from("delivery_records").insert(chunk);
          if (error) result.errors.push(`delivery insert: ${error.message}`);
          else result.deliveries.inserted += chunk.length;
        }
      }
    } catch (e) {
      result.errors.push(`delivery fetch: ${(e as Error).message}`);
    }
  }

  // ── 2. Attendance logs ─────────────────────────────────────────
  if (config.attendance) {
    try {
      let rows: RawAttendance[];
      if (config.attendance.type === "rest_api") {
        rows = await fetchFromRestApi<RawAttendance>(config.attendance, date);
      } else {
        rows = await fetchFromDatabase<RawAttendance>(
          config.attendance,
          "SELECT * FROM attendance WHERE log_date = $1",
          [date],
        );
      }
      result.attendance.fetched = rows.length;

      if (rows.length > 0) {
        const riderMap = await resolveRiders(rows.map((r) => r.driver_code));
        const clientNames = rows.map((r) => r.client_name).filter(Boolean) as string[];
        const clientMap = await resolveClients(clientNames);

        const { data: batch } = await sb
          .from("upload_batches" as any)
          .insert({ source: "cron_import_attendance", row_count: rows.length })
          .select("id")
          .single();
        const batchId = batch?.id;

        // Dedup per shift, not per day: multi-shift is a valid business case.
        const existingKeys = new Set<string>();
        const { data: existing } = await (sb as any)
          .from("attendance_logs")
          .select("client_id, client_name, driver_code, log_date, clock_in")
          .eq("log_date", date);
        (existing ?? []).forEach((e: any) => {
          existingKeys.add(attendanceKey(e, e.client_id));
        });

        const toInsert = rows
          .filter((r) => {
            const key = attendanceKey(r, clientMap.get(r.client_name ?? "") ?? null);
            if (existingKeys.has(key)) {
              result.attendance.skipped++;
              return false;
            }
            existingKeys.add(key);
            return true;
          })
          .map((r) => ({
            batch_id: batchId,
            rider_id: riderMap.get(r.driver_code) ?? null,
            driver_code: r.driver_code,
            client_id: r.client_name ? (clientMap.get(r.client_name) ?? null) : null,
            client_name: r.client_name ?? null,
            log_date: r.log_date,
            clock_in: r.clock_in ?? null,
            clock_out: r.clock_out ?? null,
            duration_minutes: r.duration_minutes ?? null,
            is_late: r.is_late ?? false,
            is_absent: r.is_absent ?? false,
            fee: r.fee ?? null,
          }));

        for (let i = 0; i < toInsert.length; i += 500) {
          const chunk = toInsert.slice(i, i + 500);
          const { error } = await (sb as any).from("attendance_logs").insert(chunk);
          if (error) result.errors.push(`attendance insert: ${error.message}`);
          else result.attendance.inserted += chunk.length;
        }
      }
    } catch (e) {
      result.errors.push(`attendance fetch: ${(e as Error).message}`);
    }
  }

  return result;
}
