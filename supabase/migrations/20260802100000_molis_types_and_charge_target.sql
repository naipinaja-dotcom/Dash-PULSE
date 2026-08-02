-- Sewa molis (motor listrik) sekarang punya jenis dengan tarif beda-beda
-- (mis. Alva, Electrum) dan tiap assignment bisa milih siapa yang nanggung
-- biayanya: rider (potong net pay, behavior lama) atau client_revenue
-- (rider tetap terima fee penuh, biayanya masuk cost di P&L client itu —
-- kasus client kasih motor gratis ke rider tapi kita yang bayar sewanya).

CREATE TABLE public.molis_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  default_daily_rate NUMERIC(12,2) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.molis_types TO authenticated;
GRANT ALL ON public.molis_types TO service_role;
ALTER TABLE public.molis_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "molis_types read auth" ON public.molis_types FOR SELECT TO authenticated USING (true);
CREATE POLICY "molis_types admin write" ON public.molis_types FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

ALTER TABLE public.rider_installments
  ADD COLUMN molis_type_id UUID REFERENCES public.molis_types,
  ADD COLUMN charge_target TEXT NOT NULL DEFAULT 'rider'
    CHECK (charge_target IN ('rider', 'client_revenue'));
