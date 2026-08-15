-- Type contract dipakai sebagai metadata Payment Request Spend Control.
-- Nullable supaya client lama bisa dilengkapi bertahap tanpa menghambat payroll.
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS contract text
    CHECK (contract IS NULL OR contract IN ('DPI', 'DEI'));
