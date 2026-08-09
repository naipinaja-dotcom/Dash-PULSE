-- Rider bisa melihat rincian yang menjadi bagian dari payslip miliknya sendiri.
-- Sebelumnya payroll_deductions dan payroll_incentives hanya punya policy
-- admin, sehingga UI rider menerima data kosong walau total di payslip ada.

drop policy if exists "pded read self" on public.payroll_deductions;
create policy "pded read own payslip" on public.payroll_deductions
  for select to authenticated
  using (
    exists (
      select 1
      from public.payroll_details detail
      join public.riders rider on rider.id = detail.rider_id
      where detail.id = payroll_deductions.detail_id
        and rider.user_id = auth.uid()
    )
  );

create policy "pinc read own payslip" on public.payroll_incentives
  for select to authenticated
  using (
    exists (
      select 1
      from public.payroll_details detail
      join public.riders rider on rider.id = detail.rider_id
      where detail.id = payroll_incentives.detail_id
        and rider.user_id = auth.uid()
    )
  );
