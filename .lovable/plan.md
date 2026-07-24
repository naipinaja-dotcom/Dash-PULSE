
# Dash PULSE — PT. DASH ELEKTRIK INDONESIA

Aplikasi payroll untuk admin & rider dengan 6 model kalkulasi pricing dinamis. Tema ungu (#7C3AED), UI Bahasa Indonesia.

## Catatan penting tentang koneksi Supabase

Spec minta connect ke project Supabase **yang sudah ada** (`ndgwfiimcvcswxzmnwoh.supabase.co`) dengan 17 tabel sudah siap. Lovable Cloud (tombol "Enable") akan membuat project Supabase **baru** — bukan yang Anda mau.

Untuk pakai project existing, ada 2 opsi:

- **A. Connect manual** — Anda buka Lovable settings → Supabase Integration → masukkan project URL + service role key dari project lama. Saya tunggu konfirmasi sebelum lanjut build halaman yang query database.
- **B. Mulai dengan Lovable Cloud baru** — saya jalankan migrasi yang me-recreate 17 tabel + view. Cepat, tapi data lama tidak ikut.

Saya rekomendasikan **A** karena spec eksplisit "Jangan buat schema baru" + data riil sudah ada di project lama. Saya akan mulai bangun frontend (auth UI, layout, halaman pricing) sambil menunggu Anda connect.

## Urutan build (sesuai spec section 6)

1. **Auth & shell** — login admin (email/password) + login rider (MTR Code + PIN → email dummy), routing role-based ke `/admin/*` vs `/rider/*`, sidebar admin, layout mobile-first rider
2. **Clients** — CRUD + ALTER TABLE tambah kolom address/contact_person/phone
3. **Riders** — list + filter status, detail rider, tombol "Buat Akun Login"
4. **Pricing Schemes** ⭐ — pakai mockup HTML yang Anda kirim sebagai blueprint persis:
   - 6 type cards (grid 3 kolom, icon + nama + desc, active state ungu)
   - Callout penjelasan per tipe
   - Form parameter dinamis (tabel area/service/tier/km/addr/box) dengan tombol "+ Tambah" dashed ungu
   - Preview estimasi pendapatan
   - Tier Jarak punya tab sub-section (Jarak/Berat/Stop Fee)
5. **Upload Data** — Delivery (CSV + column mapping disimpan ke `clients.column_mapping`, auto-create rider pending_review) + Attendance (format fixed)
6. **Attendance Rules** — rule + insentif (kondisi: Selalu/Min Durasi/OnTime/Hari Tertentu) + assign ke rider
7. **Deductions** — jenis potongan, input potongan (one-time / cicilan), list cicilan aktif
8. **Payroll Run + Calculation Engine** — 6 model + attendance + auto-deductions (Biaya Admin Rp 2.500, BPJS JKK bulanan, cicilan aktif), review draft, finalize, publish
9. **Reports** — rekap per client + export CSV
10. **Rider App** — dashboard, payslips list & detail, profil

## Design system

- Primary: `oklch` ekuivalen `#7C3AED` (ungu), light bg `#EEEDFE`, border `#AFA9EC`, deep text `#534AB7`/`#3C3489`
- Border radius medium, font sans default, table dense (font 13px, padding 6px)
- Format Rp dengan titik ribuan, tanggal `DD MMM YYYY` Indonesia
- Toast (sonner) untuk feedback, AlertDialog untuk konfirmasi hapus

## Yang saya kerjakan turn ini

Karena scope besar, turn ini saya fokus **fondasi + halaman Pricing Schemes** (item paling penting per spec: "ini yang paling penting, jangan skip"):

1. Design system ungu di `src/styles.css`
2. Layout admin (sidebar + topbar) + layout rider (mobile bottom nav)
3. Route shell: `/login`, `/admin/*`, `/rider/*` (mock auth dulu, ganti Supabase setelah connect)
4. Halaman `/admin/pricing` — list + form Tambah/Edit skema **persis mockup HTML** (6 type cards, callout, parameter dinamis per tipe, preview, footer tombol Batal/Simpan)
5. Stub halaman lain dengan "Coming next"

Setelah Anda konfirmasi koneksi Supabase (opsi A atau B), saya lanjut item 1–10 di urutan spec.

## Pertanyaan sebelum mulai

1. Opsi A atau B untuk Supabase? (default rekomendasi: A)
2. Tabel `clients` butuh ALTER (tambah address/contact_person/phone) — saya lakukan sebagai migrasi pertama setelah connect, OK?
