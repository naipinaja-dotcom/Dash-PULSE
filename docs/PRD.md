# PRD — Dash PULSE

**Produk:** Dash PULSE, PT. Dash Elektrik Indonesia (Dash Electric)
**Domain:** Otomasi kalkulasi fee rider EV last-mile delivery + business intelligence (revenue/margin) untuk vendor logistik
**Dokumen ini menggantikan:** tidak ada PRD sebelumnya di repo — ini PRD pertama, disusun dari kondisi kode aktual per 11 Juli 2026 (bukan dari asumsi lama yang sudah terbukti tidak sinkron dengan kode).
**Dokumen terkait:** `docs/BLUEPRINT.md` (arsitektur teknis), `docs/pricing-engine-v2-design.md` (rencana redesign pricing engine — status: desain, belum diimplementasi).

---

## 1. Ringkasan

Dash beroperasi sebagai vendor logistik last-mile (EV rider) untuk banyak client. Setiap client punya kombinasi skema pricing sendiri (rider dibayar dengan cara berbeda-beda tergantung kontrak dengan client), dan Dash sendiri menagih ke client dengan skema revenue yang juga bisa berbeda dari skema pembayaran ke rider. Dash PULSE adalah sistem internal (admin panel + rider portal) yang:

1. Mengotomasi perhitungan fee rider dari data pengiriman (delivery) dan absensi (attendance) mentah, dengan 6 model pricing yang bisa dikonfigurasi per client/rider tanpa ubah kode.
2. Menghasilkan laporan finansial (payroll run, payslip, deduction/potongan, bulk payment export) untuk operasional.
3. Menyediakan visibility bisnis (revenue, cost, margin/BCR) lintas client, supaya keputusan pricing dan client mana yang merugi bisa diambil berbasis data, bukan feeling.

## 2. Masalah yang Diselesaikan

- **Sebelum ada sistem ini:** perhitungan fee rider manual/spreadsheet, rawan salah hitung terutama untuk skema kompleks (tiering jarak+berat, threshold per store, kombinasi harian+per-order).
- **Variasi kontrak client:** tiap client logistik punya cara bayar rider dan cara nagih yang beda-beda — dibutuhkan sistem pricing yang composable, bukan hardcode per client.
- **Blind spot margin:** sebelum ada PNL/BCR analytics, tidak ada cara cepat melihat client mana yang secara diam-diam merugi (cost rider lebih besar dari revenue yang ditagih).
- **Reporting yang tidak konsisten:** sebelum `report_summary_weekly` dijadikan sumber tunggal, Finance dan Report page bisa menampilkan angka yang beda untuk data yang sama (lihat riwayat perbaikan di §7).

## 3. Tujuan

- Kalkulasi fee rider 100% otomatis dari data pengiriman/absensi mentah, dengan aturan pricing yang bisa diubah admin tanpa deploy kode.
- Satu sumber kebenaran (single source of truth) untuk angka payroll di semua halaman yang menampilkannya (Report, Finance Worksheet, Bulk Payment).
- Visibility margin per client secara real-time (bukan cuma saat tutup buku bulanan).
- Distribusi insight bisnis mingguan otomatis ke stakeholder (Slack + Email) tanpa perlu login ke dashboard.

## 4. Non-Tujuan (saat ini)

- Bukan sistem akuntansi/GL lengkap (tidak ada jurnal, tidak terhubung ke software akuntansi eksternal).
- Bukan sistem penggajian karyawan kantor (khusus rider EV lapangan).
- Belum ada integrasi payment gateway otomatis (bulk payment masih berupa file CSV/XLS yang diunggah manual ke internet banking/portal bank).
- BigQuery / data warehouse eksternal: prioritas rendah, belum digarap (lihat §8).

## 5. Pengguna & Peran

| Peran | Akses | Portal |
|---|---|---|
| Admin (Finance/Ops) | Full akses semua modul, RLS `admin` role via `user_roles` | `/admin/*` |
| Rider | Lihat profil, payslip, dashboard sendiri saja (RLS `user_id = auth.uid()`) | `/rider/*` |

Autentikasi lewat Supabase Auth. Rider login dengan PIN (ada flag `must_change_pin` untuk force ganti PIN pertama kali).

## 6. Fitur — Payroll Mode

Modul operasional harian, dipakai tiap periode payroll:

- **Riders** — CRUD data rider (data bank, status aktif/nonaktif, join date, client assignment).
- **Clients** — CRUD data client (kode, alamat, contact person, telepon — kolom ini sudah lengkap per perbaikan terakhir, sebelumnya sempat hilang).
- **Pricing Schemes** — konfigurasi 6 tipe kalkulasi fee (lihat §7), per client, per sisi (rider-side atau client-side/billing).
- **Attendance Upload** — impor data absensi mentah (clock in/out, telat, absen) dari file client.
- **Payroll Run** — proses hitung fee dari delivery + attendance + pricing scheme aktif, jadi satu batch periode.
- **Deductions** — potongan (cicilan/installment, dan potongan non-cicilan), dengan dukungan recurring otomatis.
- **Cek Data / Hitung Fee** — tools rekonsiliasi data mentah sebelum payroll run dieksekusi.
- **Reports** — histori data payroll per rider per run (bukan agregat mingguan asli, meski nama view-nya `report_summary_weekly` — lihat catatan di Blueprint).
- **Bulk Payment Export** — generate file CSV/XLS untuk transfer bank massal, format mengikuti template bank yang dipakai (lihat contoh: `BULK Payment Rider SI - Payment Rider RSN 2 - 8 Jul 2026.csv`), otomatis skip rider tanpa data rekening lengkap.
- **User Management** — kelola role admin/rider.

## 7. Pricing Engine (kondisi saat ini)

6 `calc_type` yang berjalan di produksi:

1. `flat_unit` — tarif per kiriman/alamat (bisa beda per area).
2. `tier` — tarif berjenjang per jarak/berat.
3. `tier_daily` — sama seperti tier, tapi akumulasi jarak/berat per rider per hari dulu baru dihitung.
4. `threshold_multiple` — kelipatan berat per area/store dibagi threshold, dibulatkan ke atas × rate.
5. `attendance` — base fee harian + komponen tambahan (custom-named, sebagian conditional).
6. `combined` — gabungan tiga komponen: fee harian proporsional jam kerja (dari absensi) + bonus ontime + fee per kiriman berjenjang (jarak/berat).

**Catatan produk penting:** tipe ke-6 (`combined`) lahir dari kebutuhan client riil (vendor logistik dengan kontrak attendance + ontime + tiering order), tapi ditambahkan secara ad hoc di atas 5 tipe yang sudah ada — bukan hasil generalisasi. Ini menyebabkan duplikasi logic (proporsi attendance dihitung ulang, order fee di `combined` cuma dukung tier padahal `flat_unit`/`threshold_multiple` juga valid dipakai bareng attendance).

**Rencana jangka menengah (sudah didesain, belum dieksekusi):** consolidasi 6 tipe ini jadi 3 kategori standar — *Per Pengiriman* (dengan subtipe flat/tier/threshold), *Per Kehadiran*, dan *Kombinasi* (subtipe pengiriman + overlay kehadiran) — **tanpa mengubah hasil kalkulasi/formula yang sudah berjalan**. Detail lengkap ada di `docs/pricing-engine-v2-design.md`. Status: design doc selesai, implementasi kode belum dimulai (menunggu prioritas).

## 8. Fitur — Intelligence Mode

Nav mode kedua (toggle di sidebar admin, terpisah dari Payroll Mode), fokus ke revenue/margin/analytics untuk kebutuhan management & client-facing:

- **Executive Dashboard** (`/admin/pnl-dashboard`) — ringkasan revenue/cost/margin lintas client per periode, tren BCR, top client by margin, client tanpa skema revenue, dan kontrol **Weekly PNL Push** (lihat §9).
- **Margin Analytics** (`/admin/pnl`) — rincian PNL per client.
- **Invoices** (`/admin/invoices`) — dipindah ke Intelligence mode karena sifatnya revenue/billing, bukan payroll rider.
- **Shipment Analytics** — volume kiriman harian, completion rate, retur, breakdown status & tipe delivery.
- **Revenue Analytics** — revenue per client, rata-rata, top client, client tanpa skema revenue, tren area chart.
- **BCR Analytics** — kategorisasi margin (rugi/tipis/sehat) per client, tren BCR dengan reference line 0% dan 15%, tabel diurutkan dari yang paling merugi.
- **Driver Analytics** — agregasi per rider: jumlah kiriman, fee kiriman, hari kerja, telat, absen, fee attendance, total earning, on-time rate.

Item yang sengaja **di-skip** dari analitik terpisah (sudah tercakup di modul lain, tidak perlu duplikasi): SLA Analytics, Area Analytics, Client Analytics, Attendance Rules Analytics (sudah masuk lingkup Pricing Schemes).

## 9. Weekly PNL Push

Snapshot PNL mingguan otomatis, didistribusikan ke **Slack + Email** (WhatsApp sengaja tidak dipakai — keputusan produk untuk membatasi channel demi kesederhanaan maintenance).

- **Trigger otomatis:** cron mingguan (Senin 07:00 WIB) lewat `pg_cron` + `pg_net`, memanggil endpoint `/api/pnl-weekly-push` dengan secret header.
- **Trigger manual:** tombol "Test Kirim Sekarang" di Executive Dashboard, pakai sesi admin yang login (bukan secret header).
- **Histori:** disimpan ke tabel `pnl_weekly_snapshots`, ditampilkan sebagai tabel 10 histori terakhir dengan status per-channel (berhasil/gagal masing-masing Slack & Email).
- **Isi pesan:** total revenue/cost/margin/margin %, daftar client yang rugi minggu itu (Slack: ringkas; Email: tabel HTML lengkap per client).

Status: **selesai dibangun**, menunggu aktivasi manual (isi env vars + jalankan SQL pg_cron di Supabase — lihat Blueprint §8).

## 10. Status Backlog Fase 2

| # | Item | Status |
|---|---|---|
| 1 | Fix referensi mati di admin dashboard | ✅ Selesai |
| 2 | Master Report Table Model (`report_summary_weekly` sebagai single source of truth) | ✅ Selesai |
| 3 | Bulk Payment CSV/XLS export sesuai template bank | ✅ Selesai |
| 4 | Dashboard Switching (Payroll ⇄ Intelligence mode toggle) | ✅ Selesai |
| 5 | Report Cost/Revenue view | ✅ Selesai (dianggap cukup, belum ada request tambahan) |
| 6 | 4 halaman Intelligence baru (Shipment/Revenue/BCR/Driver Analytics) | ✅ Selesai |
| 7 | Weekly PNL Push (Slack + Email) | ✅ Selesai — pending aktivasi cron manual |
| 8 | Calendar Reminder | ⬜ Belum digarap |
| 9 | BigQuery integration | ⬜ Belum digarap (prioritas rendah) |
| — | Pricing Engine v2 (consolidasi 3 kategori) | 📝 Desain selesai, implementasi belum dimulai |
| — | Update dokumentasi skill `dash-payroll-engine` | ⏸️ Sengaja ditahan sampai ada instruksi eksplisit |

## 11. Metrik Sukses (indikatif, belum ada baseline resmi)

- Payroll run per periode selesai tanpa perlu koreksi manual di luar sistem (dedup, cek data, hitung fee semua lewat tools yang tersedia).
- Semua halaman yang menampilkan angka payroll (Report, Finance Worksheet, Bulk Payment) menunjukkan angka yang identik untuk periode yang sama.
- Client yang marginnya negatif atau di bawah 15% teridentifikasi lewat BCR Analytics sebelum tutup buku, bukan sesudah.
- Weekly PNL Push terkirim tanpa gagal (status `ok` di kedua channel) setiap minggu setelah cron diaktifkan.

## 12. Risiko & Isu Terbuka

- **Pricing engine debt:** selama consolidasi 3-kategori belum dieksekusi, penambahan varian skema baru berisiko mengulang pola ad hoc seperti `combined`.
- **Nama `report_summary_weekly` menyesatkan** — sebenarnya grain-nya per-rider-per-run, bukan agregat mingguan. Perlu keputusan: rename view (breaking change ringan) atau biarkan dengan catatan di kode.
- **Bulk payment tidak terhubung API bank** — masih manual upload, ada risiko human error di titik ini kalau tidak dicek ulang sebelum diunggah.
- **Calendar Reminder & BigQuery** belum discope — kalau jadi kebutuhan mendesak, perlu sesi brainstorming/spec terpisah sebelum implementasi.
