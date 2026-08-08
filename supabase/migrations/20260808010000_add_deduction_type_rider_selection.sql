-- Auto-recurring types (Biaya Admin, BPJS) dulu kepotong ke SEMUA rider yang
-- ada penghasilan, gak bisa dipilih per rider. applies_to_all=false berarti
-- cuma rider yang terdaftar di deduction_type_riders yang kena.
alter table deduction_types add column applies_to_all boolean not null default true;

create table deduction_type_riders (
  id uuid primary key default gen_random_uuid(),
  deduction_type_id uuid not null references deduction_types(id) on delete cascade,
  rider_id uuid not null references riders(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (deduction_type_id, rider_id)
);
alter table deduction_type_riders enable row level security;
create policy "dtr admin all" on deduction_type_riders for all to authenticated
  using (has_role(auth.uid(), 'admin'::app_role))
  with check (has_role(auth.uid(), 'admin'::app_role));
