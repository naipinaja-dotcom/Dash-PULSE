-- Nama pendek/singkat buat dipakai di judul pengajuan Spend Control (nama
-- legal client di clients.name sering kepanjangan buat title API, mis. "PT.
-- Salam Sehat Indonesia"). Nullable — fallback ke clients.name kalau kosong.
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS project_name text;
