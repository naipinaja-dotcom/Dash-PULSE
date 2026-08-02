-- Sewa molis mode='monthly' ternyata harus tetap dihitung dari tarif harian
-- (daily_rate x jumlah hari), cuma ditagih SEKALIGUS 1x per siklus custom
-- (mis. tanggal 25 - 24 bulan depannya, BUKAN kalender 1-31) — dan siklus
-- ini bisa beda-beda per rider/assignment, makanya jadi kolom di sini,
-- bukan konstanta di kode. Default 25 kalau kosong (lihat payroll-generate.ts).
ALTER TABLE public.rider_installments
  ADD COLUMN cycle_start_day smallint
    CHECK (cycle_start_day IS NULL OR (cycle_start_day BETWEEN 1 AND 31));
