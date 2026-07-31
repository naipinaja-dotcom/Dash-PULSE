-- Nomor invoice otomatis. Format: INV/DASH/YYYY-MM/NNNN (NNNN = running global,
-- bulan diambil dari period_end). Di-generate via trigger BEFORE INSERT jadi
-- commitInvoice (admin.calculate.tsx) gak perlu diubah.

create sequence if not exists invoice_number_seq;

alter table invoice_details add column if not exists invoice_no text;

create or replace function set_invoice_no()
returns trigger language plpgsql as $$
begin
  if new.invoice_no is null then
    new.invoice_no := 'INV/DASH/'
      || to_char(coalesce(new.period_end, new.invoice_date, current_date), 'YYYY-MM')
      || '/' || lpad(nextval('invoice_number_seq')::text, 4, '0');
  end if;
  return new;
end $$;

drop trigger if exists trg_set_invoice_no on invoice_details;
create trigger trg_set_invoice_no before insert on invoice_details
  for each row execute function set_invoice_no();

-- Backfill invoice lama (urut created_at), lalu majukan sequence biar insert
-- berikutnya lanjut dari situ.
with ordered as (
  select id, row_number() over (order by created_at) rn,
         coalesce(period_end, invoice_date, created_at::date) d
  from invoice_details where invoice_no is null
)
update invoice_details i
set invoice_no = 'INV/DASH/' || to_char(o.d, 'YYYY-MM') || '/' || lpad(o.rn::text, 4, '0')
from ordered o where i.id = o.id;

select setval('invoice_number_seq', greatest((select count(*) from invoice_details), 1));

alter table invoice_details add constraint invoice_details_invoice_no_key unique (invoice_no);
