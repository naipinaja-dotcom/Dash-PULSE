import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// Daftar provider (client) dari mgmt API dashelectric — dipakai buat dropdown
// mapping "client Dash-PULSE → provider API" di menu Clients, biar semua client
// bisa diintegrasikan (bukan hardcode). Endpoint /v1/providers.
//
// Dibatasi ke revenue_stream yang dipakai bisnis ini: SCHEDULED_INSTANT & X_DOCK.

const API = "https://api.dashelectric.co/v1/providers";
const REVENUE_STREAMS = ["SCHEDULED_INSTANT", "X_DOCK"];
const PAGE_SIZE = 200;
const MAX_PAGES = 20;

export interface ApiProvider {
  id: number;
  code: string | null;
  name: string;
  revenueStreams: string[]; // stream tempat provider muncul (SCHEDULED_INSTANT / X_DOCK)
}

// Verifikasi sesi TANPA bikin Supabase client (createClient butuh WebSocket
// native yang belum ada di Node < 22). Cukup panggil /auth/v1/user via fetch.
async function assertAuth(token: string) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY belum di-set di server");
  const res = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: key, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Sesi tidak valid — coba login ulang.");
}

export const loadApiProviders = createServerFn({ method: "GET" })
  .inputValidator(z.object({ token: z.string().min(1) }))
  .handler(async ({ data }): Promise<{ providers: ApiProvider[] }> => {
    await assertAuth(data.token);
    return { providers: await fetchApiProviders() };
  });

// Pure — dipakai browser server-fn (di atas) DAN workflow payroll server-side.
export async function fetchApiProviders(): Promise<ApiProvider[]> {
  const raw = (process.env.DASH_MGMT_API_TOKEN || "").replace(/^\s*Bearer\s+/i, "").trim();
  if (!raw) throw new Error("DASH_MGMT_API_TOKEN belum di-set di server");
  const token = `Bearer ${raw}`;

  const byId = new Map<number, ApiProvider>();
  for (const rs of REVENUE_STREAMS) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = `${API}?page=${page}&size=${PAGE_SIZE}&search=&revenue_stream=${encodeURIComponent(rs)}`;
      const res = await fetch(url, { headers: { Authorization: token } });
      if (!res.ok) {
        if (res.status === 401) throw new Error("Token mgmt API ditolak / kadaluarsa (401)");
        throw new Error(`Provider API error ${res.status}`);
      }
      const json: any = await res.json();
      const list: any[] = json?.data ?? [];
      for (const p of list) {
        const existing = byId.get(p.id);
        if (existing) {
          if (!existing.revenueStreams.includes(rs)) existing.revenueStreams.push(rs);
        } else {
          byId.set(p.id, { id: p.id, code: p.code ?? null, name: p.name, revenueStreams: [rs] });
        }
      }
      const last = json?.pagination?.lastPage ?? json?.pagination?.last_page ?? 1;
      if (list.length === 0 || page >= last) break;
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}
