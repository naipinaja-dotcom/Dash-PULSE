import { createClient } from "@supabase/supabase-js";
import WS from "ws";
import type { Database } from "@/integrations/supabase/types";

// Node < 22 tidak punya `WebSocket` global; @supabase/supabase-js membuat
// RealtimeClient saat createClient() dan butuh WebSocket, jadi createClient
// bakal throw "Node.js 20 detected without native WebSocket support" tanpa ini.
// File .server.ts → aman import `ws` (tidak ke-bundle ke browser).
if (typeof (globalThis as { WebSocket?: unknown }).WebSocket === "undefined") {
  (globalThis as { WebSocket?: unknown }).WebSocket = WS as unknown;
}

// Server-only Supabase client using the service_role key — bypasses RLS
// entirely. Never import this from client code (the .server.ts suffix
// keeps Vite from bundling it into the browser). Every server function
// that uses this MUST verify the caller's role itself first.
export function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY on the server");
  }
  return createClient<Database>(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
