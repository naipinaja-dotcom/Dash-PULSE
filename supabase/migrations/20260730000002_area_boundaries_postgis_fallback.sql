-- Backend-only fallback untuk deteksi area (Kabupaten/Kota) dari koordinat
-- ketika ORS reverse-geocoding gagal ngasih district spesifik.
-- Dipakai di src/lib/api/geocoding.functions.ts (jalur upload CSV manual).
-- Data batas wilayah ADM2 Indonesia dari geoBoundaries (gbOpen, sumber
-- data.humdata.org/BPS), lisensi CC BY 3.0 IGO — di-seed terpisah, bukan di
-- migration ini (519 polygon). Nama disimpan kanonik "Kota X"/"Kabupaten X"
-- biar exact-match sama key pricing per-area dan lolos guard ambiguitas
-- Kota-vs-Kabupaten di pricing-calc.ts (findByKey).

create extension if not exists postgis;

create table if not exists area_boundaries (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  geom geometry(MultiPolygon, 4326) not null
);

create index if not exists area_boundaries_geom_gix on area_boundaries using gist (geom);

alter table area_boundaries enable row level security;

-- Backend-only: cuma admin (service role bypass RLS otomatis). Gak ada policy
-- baca buat rider — tabel ini murni referensi internal, gak ditampilin di UI.
drop policy if exists "area_boundaries admin all" on area_boundaries;
create policy "area_boundaries admin all" on area_boundaries
  for all using (has_role(auth.uid(), 'admin')) with check (has_role(auth.uid(), 'admin'));

-- Point-in-polygon: koordinat -> nama Kabupaten/Kota. Balikin NULL kalau titik
-- gak masuk polygon manapun (mis. di laut / luar Indonesia).
create or replace function area_at_point(p_lat double precision, p_lng double precision)
returns text
language sql
stable
as $$
  select name
  from area_boundaries
  where ST_Contains(geom, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326))
  limit 1;
$$;
