# Blueprint Teknis — Dash PULSE

Dokumen ini menggantikan asumsi lama di skill `dash-payroll-engine` yang sudah tidak sinkron dengan kode (contoh: skill lama bilang RLS "disabled" — kenyataannya RLS aktif di semua tabel bisnis; skill lama bilang kolom `clients.address/contact_person/phone` belum ada — kenyataannya sudah ada). Isi di bawah diverifikasi langsung dari kode & migration per 11 Juli 2026. Skill belum di-update secara sengaja (lihat `docs/PRD.md` §10) — dokumen ini yang jadi rujukan sementara sampai skill di-refresh.

---

## 1. Stack

- **Frontend/Full-stack framework:** TanStack Start (React) + TanStack Router — file-based routing, `routeTree.gen.ts` di-generate otomatis dari file di `src/routes/` (di lingkungan ini di-generate manual karena `vite`/`esbuild` native binding tidak jalan di sandbox Linux — lihat §9).
- **Backend/DB:** Supabase (Postgres + Row Level Security + Auth).
- **Styling:** Tailwind CSS.
- **Charts:** Recharts.
- **Build:** Vite (rolldown-based), Nitro (target Cloudflare Workers).
- **Package manager:** Bun (`bun.lock` ada di root; sandbox eksekusi di sini hanya punya Node).

## 2. Struktur Repo (ringkas)

```
src/
  routes/            file-based routes (admin.*.tsx, rider.*.tsx, api.*.ts)
  routeTree.gen.ts    auto-generated route tree — JANGAN edit manual kalau ada tooling; kalau manual, ikuti pola persis
  components/         admin-layout.tsx (nav + mode toggle), finance-worksheet.tsx, pricing-form.tsx, dll.
  lib/
    pricing-calc.ts    kalkulasi fee (5+1 calc_type)
    pricing-types.ts   schema PricingEnvelope, PricingScheme, PRICING_TYPES
    pricing-store.ts   CRUD pricing schemes ke Supabase
    pnl-engine.ts       computePnl() + buildTrend() — revenue/cost/margin per client
    pnl-weekly-push.server.ts   core logic Weekly PNL Push (server-only)
    notify/slack.server.ts, notify/email.server.ts
    fetch-all.ts        fetchAllRows() — pagination aman 1000 baris/halaman (browser client)
    bulk-payment-export.ts   CSV/XLS export sesuai template bank
    csv.ts, finance-export.ts   utilities export generik
    supabase-admin.server.ts    service-role client (bypass RLS, server-only)
    config.server.ts    env var accessor server-only
    api/*.functions.ts   createServerFn() RPC handlers
  integrations/supabase/types.ts   generated types dari schema (CATATAN: pricing_schemes dan view report_summary_weekly TIDAK ada di sini — lihat §9)
supabase/migrations/    SQL migrations, naming: YYYYMMDDHHMMSS_description.sql
docs/
  PRD.md               dokumen ini pasangannya — requirement & status fitur
  BLUEPRINT.md          dokumen ini
  pricing-engine-v2-design.md   desain redesign pricing engine (belum diimplementasi)
```

## 3. Peta Routing

Root punya 2 halaman non-admin (`/`, `/login`) plus 2 sub-tree utama:

**`/rider/*`** (portal rider, RLS `user_id = auth.uid()`):
`dashboard`, `payslips`, `profile`

**`/admin/*`** (portal admin, RLS role `admin`), dibagi 2 nav mode via toggle di sidebar (`src/components/admin-layout.tsx`, state `NavMode = "payroll" | "intelligence"`, persisted ke `localStorage` key `dash-admin-nav-mode`):

| Mode | Routes |
|---|---|
| **Payroll** | `dashboard`, `riders`, `clients`, `pricing/*` (index/new/$id), `upload`, `payroll`, `deductions`, `data-check`, `calculate`, `reports`, `users` |
| **Intelligence** | `pnl-dashboard` (Executive), `pnl` (Margin Analytics), `invoices`, `shipment-analytics`, `revenue-analytics`, `bcr-analytics`, `driver-analytics` |

Non-page route: `/api/pnl-weekly-push` (server-handler only, tidak punya komponen — dipanggil cron/manual trigger). `/sitemap.xml` (server-handler, contoh referensi pola API-route di `routeTree.gen.ts`).

`modeForPath(pathname)` di `admin-layout.tsx` menentukan mode default berdasarkan URL aktif, supaya refresh/deep-link tetap konsisten dengan section yang benar.

## 4. Data Model

Tabel bisnis inti (semua RLS **enabled**, policy pola `admin all` + kadang `read self` untuk rider):

- `clients` — kode, nama, address, contact_person, phone, active.
- `riders` — employee_id, full_name, phone, email, client_id, status, join_date, data bank (bank_name/bank_account/bank_account_holder), notes.
- `pricing_schemes` — name, client_id, scheme_for (`rider`|`client`), calc_type, effective_from/to, params (jsonb `PricingEnvelope`). **Tidak ada di generated `types.ts`** — semua query cast `(supabase as any)`.
- `upload_batches` — histori import file (kind, client_id, filename, row_count).
- `delivery_records` — data kiriman mentah (client_id, rider_id, driver_code, delivery_date, district, distance_km, weight_kg, destination_address, service_type, status, delivery_type, fee).
- `attendance_logs` — data absensi mentah (rider_id, client_id, log_date, clock_in/out, duration_minutes, is_late, is_absent, fee).
- `payroll_runs` — batch periode payroll (name, period range, status).
- `payroll_details` — hasil hitung per rider per run (gross_earning, net_pay, remarks, dll).
- `payroll_deductions` — potongan yang diterapkan di suatu run.
- `deduction_types` — master jenis potongan (installmentable atau tidak, recurring).
- `rider_installments` — cicilan aktif per rider.
- `payslips` — payslip yang di-generate per rider per run.
- `invoice_details` — data invoice ke client.
- `user_roles`, `profiles` — auth/role management (`has_role(uid, role)` function dipakai di semua RLS policy).
- `pnl_weekly_snapshots` — histori Weekly PNL Push (week_start/end, totals, per_client jsonb, push_status jsonb, triggered_by).

**View:** `report_summary_weekly` — join `payroll_details` + `payroll_runs` + `riders` + `clients`, dimaksudkan sebagai single source of truth untuk halaman yang menampilkan data payroll (Reports, Finance Worksheet). **Nama menyesatkan** — grain-nya per-rider-per-run, bukan agregat mingguan asli. Tidak ada di generated types, query cast `(supabase as any)`. Write path tetap ke tabel dasar (`payroll_details`) — view hanya untuk read.

**Catatan akurasi generated types:** `src/integrations/supabase/types.ts` belum di-regenerate sejak beberapa migration terakhir — selain `pricing_schemes` dan view `report_summary_weekly` yang memang tidak ada sama sekali, kolom `payroll_details.remarks` dan `riders.bank_account_holder` juga sudah ada di database (lihat migration `20260710150000_payroll_details_remarks.sql` dan penggunaan di `bulk-payment-export.ts`) tapi belum muncul di `Row`/`Insert`/`Update` types. Semua akses ke kolom ini konsisten pakai cast `(supabase as any)` — bukan bug, tapi utang regenerasi types yang perlu diingat kalau nambah kolom baru lagi.

## 5. Pricing Engine

**File:** `src/lib/pricing-calc.ts` (logic murni), `src/lib/pricing-types.ts` (schema), `src/lib/pricing-store.ts` (CRUD).

Fungsi inti:
- `calcScheme()` — dispatcher untuk `flat_unit`/`tier`/`tier_daily`/`threshold_multiple`.
- `calcAttendanceScheme()` — untuk tipe `attendance`.
- `calcCombinedScheme()` — untuk tipe `combined`; **duplikasi logic** proporsi attendance dari `calcAttendanceScheme()`, dan order-fee-nya cuma dukung tier (belum general ke flat/threshold).
- `stepTierFee()`, `allocInt()` — helper tiering & alokasi genap.

Modifier universal yang nempel di `PricingEnvelope` (di luar `config`, bisa on/off independen): `add_kg` (tier tambahan per kg), `multi_drop` (fee ekstra mulai kiriman ke-2/hari), `billing_addons` (min_charge, admin_fee_flat, ppn_percent — khusus `scheme_for: 'client'`).

**Rencana redesign (belum dieksekusi):** lihat `docs/pricing-engine-v2-design.md` — consolidasi 6 tipe jadi 3 kategori (Per Pengiriman/delivery, Per Kehadiran/attendance, Kombinasi/hybrid) tanpa mengubah formula. Rollout plan: regression harness → extract component functions (`calcFlatComponent`/`calcTierComponent`/`calcThresholdComponent`/`calcAttendanceComponent`) → ganti `calcCombinedScheme` dengan `calcHybridScheme` → migration dry-run → update schema/UI → apply migration → **update skill paling akhir**.

## 6. PNL Engine

**File:** `src/lib/pnl-engine.ts`.

- `computePnl(deliveries, schemes, clients)` — hitung revenue (skema client-side jika ada, `null` kalau client belum punya skema revenue), cost (skema rider-side), margin, marginPct per client.
- `buildTrend(perClient, granularity)` — bucket waktu (daily/weekly/monthly) untuk chart tren revenue/cost/marginPct.

Dipakai bareng di 4 tempat: `admin.pnl-dashboard.tsx` (Executive), `admin.pnl.tsx` (Margin Analytics), `admin.revenue-analytics.tsx`, `admin.bcr-analytics.tsx`, dan `pnl-weekly-push.server.ts` (untuk snapshot mingguan).

## 7. Pola Server (TanStack Start)

- **Server function (RPC-style):** `createServerFn({ method: "POST" }).inputValidator(zodSchema).handler(async ({ data }) => {...})`. Contoh: `src/lib/api/rider-auth.functions.ts`, `src/lib/api/pnl-push.functions.ts`.
- **Server route (raw HTTP):** `createFileRoute(path)({ server: { handlers: { GET/POST: async () => new Response(...) } } })`. Contoh: `sitemap[.]xml.ts`, `api.pnl-weekly-push.ts`.
- **Admin auth-in-serverFn:** helper `requireAdmin(adminToken)` — validasi token via `supabaseAdmin.auth.getUser(adminToken)`, lalu cek `user_roles` untuk role `admin`. Dipakai di setiap server function yang butuh admin gate (didefinisikan ulang per file, bukan di-share, supaya tiap file tetap bisa dibaca berdiri sendiri).
- **`.server.ts` suffix** — konvensi untuk keep kode server-only keluar dari client bundle (Vite tidak bundle file ini ke browser). Contoh: `config.server.ts`, `supabase-admin.server.ts`, `pnl-weekly-push.server.ts`, `notify/*.server.ts`.
- **Env var access pattern:**
  - `.server.ts` module: helper server-only reused lintas handler, wrap baca `process.env` di dalam fungsi (bukan module-scope) karena di Cloudflare Workers env bind per-request.
  - Inline `process.env` di dalam handler `createServerFn`: one-off read yang tidak dipakai ulang.
  - `import.meta.env.VITE_FOO`: config publik yang boleh sampai ke browser (prefix `VITE_` wajib).

## 8. Weekly PNL Push — Arsitektur

Logic inti di-share via satu module (`src/lib/pnl-weekly-push.server.ts`), dipanggil dari 2 entry point supaya business logic tidak terduplikasi:

```
              ┌─ cron (pg_cron+pg_net, header x-pnl-push-secret) ─┐
              │         → POST /api/pnl-weekly-push                │
runWeeklyPnlPush() ◄────┤                                          ├──► fetch delivery_records + pricing_schemes + clients (admin client, fetchAllRowsAdmin — paginated 1000/halaman)
              │         → triggerWeeklyPnlPushManual() server fn   │       → computePnl()
              └─ tombol "Test Kirim Sekarang" (sesi admin) ─────────┘       → sendSlackMessage() + sendEmail() (Resend)
                                                                              → insert ke pnl_weekly_snapshots
```

- **Auth cron:** header `x-pnl-push-secret` harus sama persis dengan env `PNL_PUSH_SECRET` (`verifyPnlPushSecret()`).
- **Auth manual:** sesi admin (`session.access_token`) → `requireAdmin()`.
- **Aktivasi cron:** SQL ada di `supabase/migrations/20260711140000_pnl_weekly_push_cron.sql`, sengaja di-comment (butuh isi URL production + secret manual). Jalankan manual di Supabase SQL Editor setelah `pg_cron`+`pg_net` extension diaktifkan. Default jadwal: Senin 00:00 UTC (07:00 WIB).
- **Env vars wajib:** `SLACK_WEBHOOK_URL`, `RESEND_API_KEY`, `PNL_PUSH_EMAIL_FROM`, `PNL_PUSH_EMAIL_TO`, `PNL_PUSH_SECRET`.
- **Channel:** Slack + Email saja (keputusan produk — WhatsApp sengaja tidak diimplementasi).

## 9. Konvensi & Catatan Operasional Penting

- **Migration naming:** `YYYYMMDDHHMMSS_description.sql` di `supabase/migrations/`. `20260705180000_MASTER_schema_reset.sql` adalah reset schema besar yang jadi acuan struktur tabel saat ini (idempotent, drop+rebuild tabel kosong, additive patch untuk tabel yang sudah ada datanya).
- **Cast `as any`:** tabel/view yang belum ada di generated `types.ts` (`pricing_schemes`, `report_summary_weekly`) di-query dengan `(supabase as any).from(...)` — pola yang konsisten dipakai di seluruh kode, bukan workaround sekali pakai.
- **`fetchAllRows<T>()` (browser client)** vs **`fetchAllRowsAdmin<T>()` (admin/service-role client, didefinisikan lokal di `pnl-weekly-push.server.ts`)** — dua implementasi terpisah karena `fetchAllRows` hardcode client browser dan tidak bisa dipakai di server. Keduanya page 1000 baris/halaman untuk hindari silent truncation dari Supabase.
- **Line ending file di repo ini CRLF (`\r\n`)** — perhatikan kalau nulis script/regex yang assume LF, terutama saat grep/parsing dari sandbox Linux.
- **Isu lingkungan sandbox (bukan bug kode):** `vite build`/`vite dev`/`esbuild` gagal di sandbox Linux karena native binding (`@rolldown/binding-linux-x64-gnu`) tidak cocok dengan `node_modules` yang ter-install untuk Windows. Verifikasi kode di lingkungan ini pakai `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` (pure JS, tidak butuh native binding).
- **Isu mount sandbox (bukan bug kode):** view file yang di-mount ke sandbox bash kadang stale/truncated dibanding isi asli yang sudah diedit lewat tool file. Kalau butuh verifikasi build/tsc setelah edit, cek dulu `wc -l`/`tail` file di bash vs isi yang sudah diverifikasi — kalau beda, tulis ulang file via heredoc sebelum percaya hasil tsc.

## 10. Utang Teknis Aktif

1. **Pricing engine 6→3 kategori** — desain selesai (`docs/pricing-engine-v2-design.md`), implementasi belum jalan.
2. **`calcCombinedScheme` duplikasi logic** attendance + cuma dukung order-fee tier (bukan flat/threshold) — akan hilang otomatis kalau redesign di atas dieksekusi.
3. **Nama `report_summary_weekly` menyesatkan** — grain per-rider-per-run, bukan mingguan. Belum diputuskan rename atau tidak.
4. **Bulk payment** belum terhubung API bank — masih export file manual.
5. **Calendar Reminder & BigQuery** — belum discope sama sekali.
