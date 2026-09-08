-- aad5051 nutup bug BPJS dobel di level KODE (cek chargedThisMonth sebelum
-- motong), tapi cek itu baca data run lain doang, gak ada lock -- kalau 2
-- client yang share rider sama di-generate BARENGAN persis (dua tab admin,
-- atau cron numpuk sama klik manual), dua-duanya bisa lolos cek "belum
-- kecharge" sebelum salah satu sempat INSERT. Nutup celah race itu beneran di
-- level DB: denormalisasi rider_id + closed_month (bulan yang beneran
-- ditutup run ini, replika monthsClosedOutBy di payroll-generate.ts) ke tiap
-- baris deduction, lalu UNIQUE INDEX di situ -- insert ke-2 buat
-- rider+type+bulan yang sama GAGAL (bukan lolos diam-diam), terlepas dari
-- timing race manapun. regenerate_payroll_details (RPC atomic) otomatis
-- rollback DELETE+INSERT-nya kalau constraint ini kena, jadi run yang gagal
-- generate ulang TETAP di state lama, bukan setengah ke-apply.
alter table public.payroll_deductions
  add column if not exists rider_id uuid references public.riders(id) on delete cascade,
  add column if not exists closed_month text;

update public.payroll_deductions d
set rider_id = det.rider_id,
    closed_month = (
      select (array_agg(distinct to_char(day, 'YYYY-MM')))[1]
      from generate_series(pr.period_start::date, pr.period_end::date, interval '1 day') as day
      where extract(day from day) >= 28
    )
from public.payroll_details det
join public.payroll_runs pr on pr.id = det.run_id
where det.id = d.detail_id
  and d.installment_id is null
  and exists (
    select 1 from public.deduction_types dt
    where dt.id = d.deduction_type_id and dt.trigger_frequency = 'monthly_once'
  );

update public.payroll_deductions d
set rider_id = det.rider_id
from public.payroll_details det
where det.id = d.detail_id
  and d.rider_id is null;

create unique index if not exists payroll_deductions_monthly_once_dedup_key
  on public.payroll_deductions (rider_id, deduction_type_id, closed_month)
  where closed_month is not null;

create or replace function public.payroll_deductions_set_monthly_dedup_keys()
returns trigger as $$
declare
  v_rider_id uuid;
  v_period_start date;
  v_period_end date;
  v_trigger_frequency text;
begin
  select det.rider_id, pr.period_start, pr.period_end
    into v_rider_id, v_period_start, v_period_end
  from public.payroll_details det
  join public.payroll_runs pr on pr.id = det.run_id
  where det.id = new.detail_id;

  new.rider_id := v_rider_id;

  select dt.trigger_frequency into v_trigger_frequency
  from public.deduction_types dt where dt.id = new.deduction_type_id;

  if v_trigger_frequency = 'monthly_once' and new.installment_id is null then
    select (array_agg(distinct to_char(day, 'YYYY-MM')))[1]
      into new.closed_month
    from generate_series(v_period_start, v_period_end, interval '1 day') as day
    where extract(day from day) >= 28;
  else
    new.closed_month := null;
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_payroll_deductions_monthly_dedup on public.payroll_deductions;
create trigger trg_payroll_deductions_monthly_dedup
  before insert or update of detail_id, deduction_type_id, installment_id
  on public.payroll_deductions
  for each row execute function public.payroll_deductions_set_monthly_dedup_keys();
