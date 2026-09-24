-- Siapa admin yang finalisasi payroll run — paralel sama pushed_by di
-- spend_control_pushes (20260824130000_spend_control_pushes.sql), biar UI
-- bisa nunjukin "Difinalisasi oleh X" di card Run info.
ALTER TABLE public.payroll_runs
  ADD COLUMN IF NOT EXISTS finalized_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL;
