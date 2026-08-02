-- Sewa molis buat sebagian rider dipotong SEKALI per bulan (flat), bukan
-- harian x jumlah hari periode — mis. rider yang jarang jalan tapi tetap
-- pegang unit, atau kesepakatan khusus per rider. Reuse per_period_amount
-- (kolom yang sama dipakai mode='fixed') sebagai nominal flat bulanan;
-- open-ended kayak 'daily', jalan terus sampai admin nonaktifin manual.

ALTER TABLE public.rider_installments DROP CONSTRAINT rider_installments_mode_check;
ALTER TABLE public.rider_installments ADD CONSTRAINT rider_installments_mode_check
  CHECK (mode IN ('fixed', 'daily', 'monthly'));
