-- Kolom koordinat tujuan delivery, dipakai buat auto-isi "district" lewat
-- reverse geocoding (ORS) waktu CSV cuma ada Lat/Long tapi district-nya
-- kosong/gak ada. Nullable — data lama/CSV tanpa koordinat tetap jalan.
ALTER TABLE public.delivery_records
  ADD COLUMN destination_lat NUMERIC(9,6),
  ADD COLUMN destination_lng NUMERIC(9,6);
