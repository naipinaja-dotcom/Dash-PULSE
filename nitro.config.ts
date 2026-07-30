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
// kena FUNCTION_INVOCATION_TIMEOUT (default Vercel), sementara
// /api/payroll-workflow sendiri sudah pernah makan 34 detik buat 1 client.
// 60 detik dipilih sebagai limit aman yang didukung hampir semua tier Vercel
// (termasuk Hobby) — naikkan lagi kalau ternyata masih kurang seiring makin
// banyak client yang di-link/data yang diproses.
export default defineConfig({
  vercel: {
    functionRules: {
      "/api/live-fee-sync": { maxDuration: 60 },
      "/api/payroll-workflow": { maxDuration: 60 },
    },
  },
});
