-- Basecamp Spend Control webhook (lihat src/routes/api.basecamp-webhook.ts) ngasih
-- tau status request berubah (mis. "completed") — disimpan di sini biar bisa
-- trigger auto-publish payroll run per client (lihat src/lib/payroll-publish.ts)
-- begitu Basecamp konfirmasi, bukan nunggu klik manual "Publish".
ALTER TABLE public.spend_control_pushes
  ADD COLUMN IF NOT EXISTS basecamp_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS basecamp_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS published_at timestamptz;

CREATE INDEX IF NOT EXISTS spend_control_pushes_request_id_idx
  ON public.spend_control_pushes(request_id);
