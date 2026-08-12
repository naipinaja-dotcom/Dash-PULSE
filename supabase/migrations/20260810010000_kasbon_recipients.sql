CREATE TABLE IF NOT EXISTS public.kasbon_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  bank_name text NOT NULL,
  account_number text NOT NULL,
  account_holder text NOT NULL,
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.rider_installments
  ADD COLUMN IF NOT EXISTS kasbon_recipient_id uuid REFERENCES public.kasbon_recipients(id) ON DELETE SET NULL;
ALTER TABLE public.payroll_deductions
  ADD COLUMN IF NOT EXISTS kasbon_recipient_id uuid REFERENCES public.kasbon_recipients(id) ON DELETE SET NULL;
ALTER TABLE public.kasbon_recipients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kasbon recipients admin all" ON public.kasbon_recipients FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kasbon_recipients TO authenticated;
GRANT ALL ON public.kasbon_recipients TO service_role;
NOTIFY pgrst, 'reload schema';
