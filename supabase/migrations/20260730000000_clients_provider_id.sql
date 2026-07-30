-- Persist client<->mgmt-API-provider linkage (previously resolved at runtime
-- by name-matching client.name vs provider.name in admin.calculate.tsx / lihat
-- comment "Link client-provider dipetakan by nama saat Hitung Fee"). Dibutuhkan
-- supaya cron auto-sync (tanpa sesi admin login) tahu client mana yang
-- provider-nya apa, tanpa perlu nebak dari nama.
--
-- Nullable & aditif — client lama yang belum di-link tetap jalan normal
-- (fallback name-match di admin.calculate.tsx tetap dipertahankan).
alter table public.clients add column provider_id integer;
