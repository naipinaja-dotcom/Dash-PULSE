export type DType = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  installmentable: boolean;
  active: boolean;
  auto_recurring: boolean;
  recurring_amount: number;
  trigger_frequency: string | null;
};
export type Rider = { id: string; employee_id: string; full_name: string };
export type MolisType = {
  id: string;
  name: string;
  default_daily_rate: number;
  active: boolean;
};
export type Inst = {
  id: string;
  rider_id: string;
  deduction_type_id: string;
  mode: "fixed" | "daily" | "monthly";
  total_amount: number | null;
  installment_count: number | null;
  installments_paid: number;
  per_period_amount: number | null;
  daily_rate: number | null;
  molis_type_id: string | null;
  charge_target: "rider" | "client_revenue";
  start_date: string;
  next_deduction_date: string | null;
  active: boolean;
  notes: string | null;
};
