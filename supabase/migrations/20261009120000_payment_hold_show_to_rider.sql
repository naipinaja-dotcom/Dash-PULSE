-- Admin bisa pilih apakah status "Pembayaran ditahan" (dan alasannya) kelihatan
-- di payslip rider. Default true = perilaku lama (tetap ditampilkan). Dipasang
-- juga di policy baca rider, jadi baris yang disembunyikan memang gak bisa
-- dibaca rider lewat API — bukan cuma disembunyikan di UI.
ALTER TABLE public.payroll_payment_holds
  ADD COLUMN IF NOT EXISTS show_to_rider boolean NOT NULL DEFAULT true;

DROP POLICY IF EXISTS "payment holds rider read self" ON public.payroll_payment_holds;
CREATE POLICY "payment holds rider read self" ON public.payroll_payment_holds
  FOR SELECT TO authenticated
  USING (
    show_to_rider
    AND rider_id IN (SELECT id FROM public.riders WHERE user_id = auth.uid())
  );
