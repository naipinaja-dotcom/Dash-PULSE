-- Keep operational data visible in P&L when an import identifies the rider
-- but omits client_id. An explicit client_id always wins; rider.client_id is
-- only a fallback for otherwise unassigned records.
create or replace function public.fill_delivery_client_from_rider()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.client_id is null and new.rider_id is not null then
    select client_id
      into new.client_id
      from public.riders
     where id = new.rider_id;
  end if;

  return new;
end;
$$;

drop trigger if exists delivery_records_fill_client_from_rider on public.delivery_records;

create trigger delivery_records_fill_client_from_rider
before insert or update of rider_id, client_id on public.delivery_records
for each row
execute function public.fill_delivery_client_from_rider();
