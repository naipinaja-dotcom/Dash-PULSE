-- Run EWA (Early Wages): payout upah lebih awal buat rider tertentu, terpisah
-- dari run gaji reguler (lihat admin.calculate.tsx mode EWA & payroll-generate.ts).
-- kind='ewa' + rider_scope membedakannya dari run reguler; run reguler periode
-- yang overlap otomatis motong balik net run EWA yang sudah published.
-- rider_scope text[] (bukan uuid[]): rider key dari Hitung Fee bisa berupa
-- driver_code untuk baris legacy yang rider_id-nya putus, jadi disimpan sebagai
-- teks biar cocok dengan cara generatePayrollDetails memfilter rider.
ALTER TABLE public.payroll_runs
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'regular',
  ADD COLUMN IF NOT EXISTS rider_scope text[];
