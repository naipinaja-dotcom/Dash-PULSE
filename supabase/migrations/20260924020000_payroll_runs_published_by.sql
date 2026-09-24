-- Siapa admin yang publish payroll run — paralel sama finalized_by
-- (20260924010000_payroll_runs_finalized_by.sql), biar card Run info bisa
-- nunjukin "Dipublish oleh X" juga.
ALTER TABLE public.payroll_runs
  ADD COLUMN IF NOT EXISTS published_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL;
