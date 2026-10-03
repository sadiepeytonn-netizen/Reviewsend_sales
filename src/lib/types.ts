export type UserRole = "admin" | "manager" | "rep";

export type Profile = {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  team_id: string | null;
  active: boolean;
  must_change_password: boolean;
  created_at: string;
};

export type ResidualKind = "none" | "flat" | "percent";

export type CommissionPlanRow = {
  id: string;
  rep_id: string;
  effective_from: string;
  first_month_pct_with_setup: number;
  first_month_pct_without_setup: number;
  residual_kind: ResidualKind;
  residual_value: number;
  small_deal_max_monthly: number;
  small_deal_first_month_pct: number;
  small_deal_gets_residual: boolean;
  created_at: string;
};
