-- =========================================================
-- Area City Pricing (PRD "prd skema outer.md"): tambah kolom City MGMT
-- mentah (meta.city), TERPISAH dari `district` (hasil enrichment alamat/
-- ORS/PostGIS) — dasar pemilihan rule di resolveAreaPricingRule
-- (pricing-calc.ts). Additive, nullable, tanpa backfill — delivery lama
-- yang belum punya city tetap fallback ke pricing default (lihat PRD).
-- =========================================================
ALTER TABLE public.delivery_records
  ADD COLUMN IF NOT EXISTS city text;

-- replace_live_deliveries (lihat 20260809000000_atomic_live_sync.sql) perlu
-- ikut nyimpen city — kalau enggak, sync live selalu nulis NULL walau
-- payload dari sync-live-deliveries.ts sudah kirim field-nya.
create or replace function replace_live_deliveries(
  p_client_id uuid,
  p_rows jsonb default '[]'::jsonb
)
returns table(overwritten integer, inserted integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' and not has_role(auth.uid(), 'admin'::app_role) then
    raise exception 'Only admins can sync deliveries';
  end if;

  perform pg_advisory_xact_lock(hashtext('live-deliveries:' || p_client_id::text));

  delete from delivery_records d
  where d.client_id = p_client_id
    and (
      d.dash_delivery_id in (
        select nullif(trim(x->>'dash_delivery_id'), '') from jsonb_array_elements(p_rows) x
      )
      or d.provider_order_id in (
        select nullif(trim(x->>'provider_order_id'), '') from jsonb_array_elements(p_rows) x
      )
    );
  get diagnostics overwritten = row_count;

  insert into delivery_records (
    batch_id, client_id, rider_id, driver_code, status, dash_delivery_id,
    provider_order_id, delivery_date, awb, district, city, distance_km, weight_kg,
    destination_address, destination_lat, destination_lng, sender_name,
    receiver_name, service_type, delivery_type, fee
  )
  select
    (x->>'batch_id')::uuid, p_client_id, (x->>'rider_id')::uuid,
    x->>'driver_code', x->>'status', nullif(trim(x->>'dash_delivery_id'), ''),
    nullif(trim(x->>'provider_order_id'), ''), (x->>'delivery_date')::date,
    x->>'awb', x->>'district', x->>'city', (x->>'distance_km')::numeric,
    (x->>'weight_kg')::numeric, x->>'destination_address',
    (x->>'destination_lat')::numeric, (x->>'destination_lng')::numeric,
    x->>'sender_name', x->>'receiver_name', x->>'service_type',
    coalesce(x->>'delivery_type', 'DELIVERY'), coalesce((x->>'fee')::numeric, 0)
  from jsonb_array_elements(p_rows) x
  where coalesce(nullif(trim(x->>'dash_delivery_id'), ''), nullif(trim(x->>'provider_order_id'), '')) is not null;
  get diagnostics inserted = row_count;
  return next;
end;
$$;
