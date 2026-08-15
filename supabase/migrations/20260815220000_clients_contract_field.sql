-- Kontrak legal entity per client (PT DPI vs PT DEI), dibutuhkan untuk field
-- `contract` saat push Payment Request ke Spend Control (basecamp.dashelectric.co).
-- Dropdown Contract di Spend Control sendiri cuma punya 2 pilihan ini.
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS contract text
    CHECK (contract IS NULL OR contract IN ('DPI', 'DEI'));
