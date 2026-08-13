-- Sebagian penerima kasbon itu REKENING PERUSAHAAN SENDIRI (bukan pihak ke-3
-- beneran) — mis. rider ngasbon ke perusahaan, bukan ke orang/vendor luar.
-- Potongannya tetap sah (masuk net_pay rider seperti biasa), tapi duitnya
-- gak perlu ditransfer balik (udah "masuk" begitu dipotong dari net_pay,
-- gak pernah keluar rekening perusahaan). Flag ini per-PENERIMA (bukan
-- per-transaksi) — sekali di-set di halaman Penerima Kasbon, berlaku ke
-- semua deduction yang nunjuk ke penerima itu.
alter table public.kasbon_recipients
  add column if not exists no_transfer_needed boolean not null default false;
NOTIFY pgrst, 'reload schema';
