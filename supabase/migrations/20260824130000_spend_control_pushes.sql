-- Histori push per (run, client) ke Basecamp Spend Control — biar dialog
-- "Push ke Spend Control" bisa nunjukin status yang udah pernah sukses
-- walau dialog ditutup-buka lagi / halaman di-reload, dan gak dobel push
-- client yang sama.
CREATE TABLE IF NOT EXISTS public.spend_control_pushes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id uuid NOT NULL REFERENCES public.payroll_runs(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  request_id text NOT NULL,
  request_code text,
  amount numeric(14,2) NOT NULL,
  department text NOT NULL,
  workflow_configured boolean NOT NULL DEFAULT true,
  workflow_missing_reason text,
  pushed_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  pushed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payroll_run_id, client_id)
);

CREATE INDEX IF NOT EXISTS spend_control_pushes_run_idx
  ON public.spend_control_pushes(payroll_run_id);

ALTER TABLE public.spend_control_pushes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "spend control pushes admin all" ON public.spend_control_pushes
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
