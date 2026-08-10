-- Hold pembayaran rider tidak mengubah payroll/payslip yang sudah dihitung.
-- Saat hold dilepas, nominal net_pay asli dibuat sebagai payout susulan terpisah.

CREATE TABLE IF NOT EXISTS public.payroll_payment_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  detail_id uuid NOT NULL UNIQUE REFERENCES public.payroll_details(id) ON DELETE CASCADE,
  rider_id uuid NOT NULL REFERENCES public.riders(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  status text NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'released')),
  held_at timestamptz NOT NULL DEFAULT now(),
  held_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  released_at timestamptz,
  released_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.payroll_follow_up_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hold_id uuid NOT NULL UNIQUE REFERENCES public.payroll_payment_holds(id) ON DELETE RESTRICT,
  detail_id uuid NOT NULL REFERENCES public.payroll_details(id) ON DELETE RESTRICT,
  rider_id uuid NOT NULL REFERENCES public.riders(id) ON DELETE RESTRICT,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'exported')),
  exported_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payroll_payment_holds_detail_id_idx
  ON public.payroll_payment_holds(detail_id);
CREATE INDEX IF NOT EXISTS payroll_follow_up_payments_rider_status_idx
  ON public.payroll_follow_up_payments(rider_id, status);

ALTER TABLE public.payroll_payment_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_follow_up_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payment holds admin all" ON public.payroll_payment_holds
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "payment holds rider read self" ON public.payroll_payment_holds
  FOR SELECT TO authenticated
  USING (rider_id IN (SELECT id FROM public.riders WHERE user_id = auth.uid()));

CREATE POLICY "follow up payments admin all" ON public.payroll_follow_up_payments
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "follow up payments rider read self" ON public.payroll_follow_up_payments
  FOR SELECT TO authenticated
  USING (rider_id IN (SELECT id FROM public.riders WHERE user_id = auth.uid()));

-- Atomic: mengunci hold, mengambil net_pay dari detail payroll asli, lalu
-- membuat satu (dan hanya satu) antrean pembayaran susulan.
CREATE OR REPLACE FUNCTION public.release_held_payroll_payment(p_hold_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_hold public.payroll_payment_holds;
  v_amount numeric(12,2);
  v_payment_id uuid;
BEGIN
  SELECT * INTO v_hold
  FROM public.payroll_payment_holds
  WHERE id = p_hold_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Data hold pembayaran tidak ditemukan';
  END IF;
  IF v_hold.status <> 'held' THEN
    RAISE EXCEPTION 'Pembayaran ini sudah dilepas sebelumnya';
  END IF;

  SELECT net_pay INTO v_amount
  FROM public.payroll_details
  WHERE id = v_hold.detail_id;
  IF COALESCE(v_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'Net pay rider harus lebih dari Rp0 untuk pembayaran susulan';
  END IF;

  UPDATE public.payroll_payment_holds
  SET status = 'released', released_at = now(), released_by = auth.uid(), updated_at = now()
  WHERE id = v_hold.id;

  INSERT INTO public.payroll_follow_up_payments (hold_id, detail_id, rider_id, amount)
  VALUES (v_hold.id, v_hold.detail_id, v_hold.rider_id, v_amount)
  RETURNING id INTO v_payment_id;

  RETURN v_payment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.release_held_payroll_payment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_held_payroll_payment(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
