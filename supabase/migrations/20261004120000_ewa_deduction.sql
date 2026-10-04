-- EWA (Early Wages / Earned Wage Access): upah yang sudah dicairkan duluan lewat
-- request Basecamp terpisah. Dicatat per rider sebagai potongan SEKALI
-- (rider_installments mode='fixed', installment_count=1) supaya payroll reguler
-- periode yang sama memotongnya dan rider tidak terbayar dobel.
-- Tipe EWA bisa sudah ada (dibuat manual di DB produksi dan sudah dipakai) — jangan
-- disentuh. deduction_types.code tidak punya constraint unik di DB live, jadi pakai
-- WHERE NOT EXISTS (bukan ON CONFLICT).
INSERT INTO public.deduction_types (code, name, description, installmentable, active)
SELECT
  'EWA',
  'EWA (Early Wages)',
  'Upah yang sudah dicairkan lebih awal (Earned Wage Access), dipotong dari payroll reguler.',
  true,
  true
WHERE NOT EXISTS (SELECT 1 FROM public.deduction_types WHERE code = 'EWA');

-- Kode request Basecamp asal EWA ini (mis. OPS-SCH-PM-20261003-XXXXXX).
ALTER TABLE public.rider_installments
  ADD COLUMN IF NOT EXISTS ewa_request_code text;

-- Batch EWA yang sama (rider + kode request) tidak boleh tercatat dua kali —
-- guard kalau daftar yang sama ke-paste/ke-simpan ulang.
CREATE UNIQUE INDEX IF NOT EXISTS rider_installments_ewa_request_key
  ON public.rider_installments (rider_id, ewa_request_code)
  WHERE ewa_request_code IS NOT NULL;
