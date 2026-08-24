// Ambil businessUnit Spend Control dari revenueStreams provider yang terhubung
// ke client (via clients.provider_id). Kalau provider punya kedua stream,
// prioritaskan SCHEDULED (payroll disbursement selalu terjadwal, bukan
// on-demand/instant XDOCK). Pure mapping, dipanggil dari client component
// (admin.payroll.tsx) — bukan .server.ts karena tidak menyentuh secret/Node-only
// API.
//
// SENGAJA BEDA dari 2 resolver serupa yang sudah ada (admin.calculate.tsx
// & live-fee-sync.server.ts), yang treat dual-stream sebagai ambigu ("" /
// null) karena konteksnya cuma tampilan read-only. Di sini businessUnit WAJIB
// dikirim ke Spend Control — gak ada opsi "ambigu" di form mereka — jadi
// harus selalu balikin salah satu, bukan null/"". Kalau ada perubahan
// business rule soal prioritas stream, cek juga 2 tempat lain itu.
//
// Nilai balik HARUS persis enum businessUnit di API Spend Control (lihat
// spend-request-api-integration.md §11) — bukan nama internal revenueStreams kita.
export function resolveBusinessUnit(revenueStreams: string[]): "SCHEDULED" | "XDOCK" | null {
  if (revenueStreams.includes("SCHEDULED_INSTANT")) return "SCHEDULED";
  if (revenueStreams.includes("X_DOCK")) return "XDOCK";
  return null;
}

// Kode department Spend Control (bukan label) — lihat §11 guide. API
// menyimpan kode apa adanya tanpa validasi; kode salah = silently gagal
// match workflow (workflowConfigured: false selamanya). UI cuma nampilin
// label, request body wajib kirim code.
export const SPEND_CONTROL_DEPARTMENTS: { code: string; label: string }[] = [
  { code: "CS", label: "Customer Success" },
  { code: "EPD", label: "Engineering Product & Design" },
  { code: "FIN", label: "Finance" },
  { code: "FLEET", label: "Fleet" },
  { code: "HR", label: "Human Resources" },
  { code: "LEGAL", label: "Legal" },
  { code: "LOGISTICS", label: "Logistics" },
  { code: "MKT", label: "Marketing" },
  { code: "OPS", label: "Operations" },
  { code: "SALES", label: "Sales" },
  { code: "TECH", label: "Technology" },
];
