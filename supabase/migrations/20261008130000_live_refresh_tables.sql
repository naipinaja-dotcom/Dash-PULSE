-- Auto-refresh semua halaman (hook useLiveTick): daftarin tabel yang dipantau
-- ke publication supabase_realtime. Idempoten — lewati tabel yang udah
-- terdaftar atau belum ada.
-- SENGAJA gak masuk: clients & deduction_types (RLS mati — event realtime-nya
-- bakal nyebar datanya ke semua client yang subscribe), serta delivery_records
-- & attendance_logs (insert massal; halaman pantau upload_batches aja).
do $$
declare
  t text;
begin
  foreach t in array array[
    'payroll_runs', 'payroll_details', 'payroll_deductions', 'spend_control_pushes',
    'riders', 'rider_installments', 'invoice_details', 'profiles', 'user_roles',
    'payslips', 'upload_batches', 'pricing_schemes', 'kasbon_recipients',
    'molis_types', 'payroll_payment_holds', 'payroll_incentives', 'pnl_weekly_snapshots'
  ]
  loop
    if to_regclass('public.' || t) is not null and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
