-- replace_live_attendance() inserted clock_in/clock_out as bare text (no cast)
-- into columns typed `time without time zone`, unlike every other typed
-- column here (log_date::date, fee::numeric, etc). Postgres has no implicit
-- cast from a jsonb ->> text expression to `time`, so any sync ("Tarik &
-- Sync dari API") failed with:
--   column "clock_in" is of type time without time zone but expression is
--   of type text
-- nullif(...,'') guards the (currently unused but cheap-to-guard) empty-
-- string case the same way dash_delivery_id/provider_order_id already do
-- in replace_live_deliveries() above.
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
    (x->>'log_date')::date, nullif(x->>'clock_in', '')::time, nullif(x->>'clock_out', '')::time,
    (x->>'duration_minutes')::integer, coalesce((x->>'is_late')::boolean, false),
    coalesce((x->>'is_absent')::boolean, false), coalesce((x->>'fee')::numeric, 0)
  from jsonb_array_elements(p_rows) x;
  get diagnostics inserted = row_count;
  return next;
end;
$$;

revoke execute on function replace_live_attendance(uuid, date, date, jsonb) from public;
grant execute on function replace_live_attendance(uuid, date, date, jsonb) to authenticated, service_role;
