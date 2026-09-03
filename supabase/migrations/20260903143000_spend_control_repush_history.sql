-- Re-push Spend Control membuat request baru, jadi request sebelumnya tidak
-- boleh tertimpa. Simpan urutan attempt dan relasi ke request yang digantikan.
ALTER TABLE public.spend_control_pushes
  ADD COLUMN IF NOT EXISTS attempt integer NOT NULL DEFAULT 1 CHECK (attempt > 0),
  ADD COLUMN IF NOT EXISTS is_repush boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS supersedes_request_id text;

ALTER TABLE public.spend_control_pushes
  DROP CONSTRAINT IF EXISTS spend_control_pushes_payroll_run_id_client_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS spend_control_pushes_run_client_attempt_key
  ON public.spend_control_pushes (payroll_run_id, client_id, attempt);
