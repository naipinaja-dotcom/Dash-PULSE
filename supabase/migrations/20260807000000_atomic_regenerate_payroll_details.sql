-- generatePayrollDetails() dulu delete payroll_details lalu, ratusan baris
-- komputasi kemudian, insert payroll_details+payroll_deductions — kalau apa
-- pun di antaranya throw (query gagal, error jaringan), run itu ketinggalan
-- kosong/separuh. Bungkus delete+insert+insert jadi satu function Postgres
-- (satu transaction implisit) biar atomic: gagal = payroll_details run itu
-- tetap utuh kayak sebelum "Generate Ulang" ditekan.
create or replace function regenerate_payroll_details(
  p_run_id uuid,
  p_details jsonb default '[]'::jsonb,
  p_deductions jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Dua caller sah: admin browser (authenticated + has_role admin) DAN
  -- cron/workflow server-only (service_role, getSupabaseAdmin() — gak ada
  -- auth.uid() sama sekali, lihat payroll-workflow.server.ts).
  if auth.role() <> 'service_role' and not has_role(auth.uid(), 'admin'::app_role) then
    raise exception 'Only admins can regenerate payroll details';
  end if;

  delete from payroll_details where run_id = p_run_id;

  insert into payroll_details (
    id, run_id, rider_id, client_id, delivery_count, delivery_fee,
    attendance_fee, incentive, penalty, gross_earning, total_deduction, net_pay
  )
  select
    (d->>'id')::uuid, (d->>'run_id')::uuid, (d->>'rider_id')::uuid, (d->>'client_id')::uuid,
    (d->>'delivery_count')::int, (d->>'delivery_fee')::numeric,
    (d->>'attendance_fee')::numeric, (d->>'incentive')::numeric, (d->>'penalty')::numeric,
    (d->>'gross_earning')::numeric, (d->>'total_deduction')::numeric, (d->>'net_pay')::numeric
  from jsonb_array_elements(p_details) as d;

  insert into payroll_deductions (detail_id, deduction_type_id, installment_id, description, amount)
  select
    (x->>'detail_id')::uuid, (x->>'deduction_type_id')::uuid, (x->>'installment_id')::uuid,
    x->>'description', (x->>'amount')::numeric
  from jsonb_array_elements(p_deductions) as x;
end;
$$;

revoke execute on function regenerate_payroll_details(uuid, jsonb, jsonb) from public;
grant execute on function regenerate_payroll_details(uuid, jsonb, jsonb) to authenticated, service_role;
