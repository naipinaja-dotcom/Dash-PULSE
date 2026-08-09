-- Live sync must never leave a client with data deleted but not re-inserted.
-- These functions run delete + insert in one transaction.  The advisory lock
-- serializes retries for the same client, so a successful retry replaces the
-- previous result instead of creating duplicates.

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
    provider_order_id, delivery_date, awb, district, distance_km, weight_kg,
    destination_address, destination_lat, destination_lng, sender_name,
    receiver_name, service_type, delivery_type, fee
  )
  select
    (x->>'batch_id')::uuid, p_client_id, (x->>'rider_id')::uuid,
    x->>'driver_code', x->>'status', nullif(trim(x->>'dash_delivery_id'), ''),
    nullif(trim(x->>'provider_order_id'), ''), (x->>'delivery_date')::date,
    x->>'awb', x->>'district', (x->>'distance_km')::numeric,
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

create or replace function replace_live_attendance(
  p_client_id uuid,
  p_from date,
  p_to date,
  p_rows jsonb default '[]'::jsonb
)
returns table(inserted integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' and not has_role(auth.uid(), 'admin'::app_role) then
    raise exception 'Only admins can sync attendance';
  end if;

  perform pg_advisory_xact_lock(hashtext('live-attendance:' || p_client_id::text));

  delete from attendance_logs
  where client_id = p_client_id and log_date between p_from and p_to;

  insert into attendance_logs (
    batch_id, client_id, rider_id, driver_code, client_name, pitstop_name,
    log_date, clock_in, clock_out, duration_minutes, is_late, is_absent, fee
  )
  select
    (x->>'batch_id')::uuid, p_client_id, (x->>'rider_id')::uuid,
    x->>'driver_code', x->>'client_name', x->>'pitstop_name',
    (x->>'log_date')::date, x->>'clock_in', x->>'clock_out',
    (x->>'duration_minutes')::integer, coalesce((x->>'is_late')::boolean, false),
    coalesce((x->>'is_absent')::boolean, false), coalesce((x->>'fee')::numeric, 0)
  from jsonb_array_elements(p_rows) x;
  get diagnostics inserted = row_count;
  return next;
end;
$$;

revoke execute on function replace_live_deliveries(uuid, jsonb) from public;
grant execute on function replace_live_deliveries(uuid, jsonb) to authenticated, service_role;
revoke execute on function replace_live_attendance(uuid, date, date, jsonb) from public;
grant execute on function replace_live_attendance(uuid, date, date, jsonb) to authenticated, service_role;
