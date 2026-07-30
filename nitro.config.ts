import { defineConfig } from "nitro";

// Nitro auto-discovers this file at project root — sengaja TIDAK ditaruh di
// vite.config.ts, karena wrapper @lovable.dev/vite-tanstack-config yang
// dipakai project ini sengaja membatasi opsi nitro cuma ke
// preset/output/cloudflare (lihat komentar di vite.config.ts), gak ada jalur
// buat vercel.functionRules lewat situ.
//
// maxDuration: cron /api/live-fee-sync & /api/payroll-workflow ngerjain
// banyak hal per invocation (tarik API dashelectric berhalaman-halaman,
// hitung fee, upsert DB, generate Payroll Run) — /api/live-fee-sync sempat
// kena FUNCTION_INVOCATION_TIMEOUT di 60 detik (dikonfirmasi lewat runtime
// log: "Task timed out after 60 seconds", jadi config INI beneran kepakai,
// bukan default Vercel yang gak keubah). Diukur langsung: ~9 client di daftar
// reminder makan ~17-18 detik/client (paginasi + retry ke mgmt API dashelectric,
// hitung fee, upsert DB) = ~150-160 detik total, jauh di atas 60. 300 detik
// dipilih sebagai limit umum yang didukung tier Vercel Pro tanpa perlu Fluid
// Compute — naikkan lagi (butuh Fluid Compute buat >300s) kalau makin banyak
// client di daftar reminder ke depannya.
export default defineConfig({
  vercel: {
    functionRules: {
      "/api/live-fee-sync": { maxDuration: 300 },
      "/api/payroll-workflow": { maxDuration: 300 },
    },
  },
});
