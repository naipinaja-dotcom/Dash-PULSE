CREATE OR REPLACE FUNCTION public.regenerate_payroll_details(
  p_run_id uuid, p_details jsonb DEFAULT '[]'::jsonb, p_deductions jsonb DEFAULT '[]'::jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only admins can regenerate payroll details';
  END IF;
  DELETE FROM public.payroll_details WHERE run_id = p_run_id;
  INSERT INTO public.payroll_details (id, run_id, rider_id, client_id, delivery_count, delivery_fee, attendance_fee, incentive, penalty, gross_earning, total_deduction, net_pay)
  SELECT (d->>'id')::uuid, (d->>'run_id')::uuid, (d->>'rider_id')::uuid, (d->>'client_id')::uuid,
    (d->>'delivery_count')::int, (d->>'delivery_fee')::numeric, (d->>'attendance_fee')::numeric,
    (d->>'incentive')::numeric, (d->>'penalty')::numeric, (d->>'gross_earning')::numeric,
    (d->>'total_deduction')::numeric, (d->>'net_pay')::numeric
  FROM jsonb_array_elements(p_details) AS d;
  INSERT INTO public.payroll_deductions (detail_id, deduction_type_id, installment_id, kasbon_recipient_id, description, amount)
  SELECT (x->>'detail_id')::uuid, (x->>'deduction_type_id')::uuid, (x->>'installment_id')::uuid,
    (x->>'kasbon_recipient_id')::uuid, x->>'description', (x->>'amount')::numeric
  FROM jsonb_array_elements(p_deductions) AS x;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.regenerate_payroll_details(uuid, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.regenerate_payroll_details(uuid, jsonb, jsonb) TO authenticated, service_role;
