-- Cicilan bisa dipilih eligible di BEBERAPA client sekaligus (bukan cuma 1
-- "client prioritas") — buat rider yang kerja di lebih dari 1 client, biar
-- gak keskip potongannya kalau kebetulan gak ada earning di client
-- prioritasnya periode ini. Array KOSONG/NULL = fallback ke perilaku lama
-- (client_id tunggal / client rumah rider), backward compatible penuh.
-- Urutan array = urutan prioritas admin (lihat matchesClient di payroll-generate.ts).
ALTER TABLE public.rider_installments
  ADD COLUMN IF NOT EXISTS client_ids uuid[];
