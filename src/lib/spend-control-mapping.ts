// Ambil businessUnit Spend Control dari revenueStreams provider yang terhubung
// ke client (via clients.provider_id). Kalau provider punya kedua stream,
// prioritaskan SCHEDULED_INSTANT (payroll disbursement selalu terjadwal,
// bukan on-demand/instant X_DOCK). Pure mapping, dipanggil dari client
// component (admin.payroll.tsx) — bukan .server.ts karena tidak menyentuh
// secret/Node-only API.
export function resolveBusinessUnit(revenueStreams: string[]): "SCHEDULED_INSTANT" | "X_DOCK" | null {
  if (revenueStreams.includes("SCHEDULED_INSTANT")) return "SCHEDULED_INSTANT";
  if (revenueStreams.includes("X_DOCK")) return "X_DOCK";
  return null;
}
