-- Realtime untuk halaman Payroll Run: perubahan status run / detail / potongan /
-- push Spend Control (termasuk dari webhook Basecamp) langsung ke-refresh di
-- layar tanpa reload. Idempoten — aman dijalankan ulang.
do $$
declare
  t text;
begin
  foreach t in array array['payroll_runs', 'payroll_details', 'payroll_deductions', 'spend_control_pushes']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
