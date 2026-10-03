import type { CommissionPlanRow, ResidualKind } from "@/lib/types";

export type CommissionPlan = {
  firstMonthPctWithSetup: number;
  firstMonthPctWithoutSetup: number;
  residualKind: ResidualKind;
  residualValue: number;
  smallDealMaxMonthly: number;
  smallDealFirstMonthPct: number;
  smallDealGetsResidual: boolean;
};

export function planFromRow(row: CommissionPlanRow): CommissionPlan {
  return {
    firstMonthPctWithSetup: Number(row.first_month_pct_with_setup),
    firstMonthPctWithoutSetup: Number(row.first_month_pct_without_setup),
    residualKind: row.residual_kind,
    residualValue: Number(row.residual_value),
    smallDealMaxMonthly: Number(row.small_deal_max_monthly),
    smallDealFirstMonthPct: Number(row.small_deal_first_month_pct),
    smallDealGetsResidual: row.small_deal_gets_residual,
  };
}

// Starting points the admin can pick from when setting a rep's plan.
export const PLAN_TEMPLATES: Record<string, { label: string; plan: CommissionPlan }> = {
  standard: {
    label: "Standard — 40% first month, $75/mo residual",
    plan: {
      firstMonthPctWithSetup: 40,
      firstMonthPctWithoutSetup: 40,
      residualKind: "flat",
      residualValue: 75,
      smallDealMaxMonthly: 199,
      smallDealFirstMonthPct: 40,
      smallDealGetsResidual: false,
    },
  },
  ryan: {
    label: "50% first month (even small deals), $100/mo residual",
    plan: {
      firstMonthPctWithSetup: 50,
      firstMonthPctWithoutSetup: 50,
      residualKind: "flat",
      residualValue: 100,
      smallDealMaxMonthly: 199,
      smallDealFirstMonthPct: 50,
      smallDealGetsResidual: false,
    },
  },
  corban: {
    label: "50% with setup fee / 40% without, 30% monthly residual",
    plan: {
      firstMonthPctWithSetup: 50,
      firstMonthPctWithoutSetup: 40,
      residualKind: "percent",
      residualValue: 30,
      smallDealMaxMonthly: 199,
      smallDealFirstMonthPct: 40,
      smallDealGetsResidual: false,
    },
  },
};

export const DEFAULT_PLAN = PLAN_TEMPLATES.standard.plan;

const round2 = (n: number) => Math.round(n * 100) / 100;

export function isSmallDeal(plan: CommissionPlan, monthlyPrice: number): boolean {
  return monthlyPrice <= plan.smallDealMaxMonthly;
}

// Commission on the first payment (setup fee + first month).
export function firstMonthCommission(plan: CommissionPlan, setupFee: number, monthlyPrice: number) {
  const base = setupFee + monthlyPrice;
  const pct = isSmallDeal(plan, monthlyPrice)
    ? plan.smallDealFirstMonthPct
    : setupFee > 0
      ? plan.firstMonthPctWithSetup
      : plan.firstMonthPctWithoutSetup;
  return { base, pct, amount: round2((base * pct) / 100) };
}

// Commission earned each month the client pays, starting in month 2.
export function monthlyResidual(plan: CommissionPlan, monthlyPrice: number): number {
  if (isSmallDeal(plan, monthlyPrice) && !plan.smallDealGetsResidual) return 0;
  switch (plan.residualKind) {
    case "flat":
      return plan.residualValue;
    case "percent":
      return round2((monthlyPrice * plan.residualValue) / 100);
    default:
      return 0;
  }
}

export function describePlan(plan: CommissionPlan): string[] {
  const lines: string[] = [];
  if (plan.firstMonthPctWithSetup === plan.firstMonthPctWithoutSetup) {
    lines.push(`${plan.firstMonthPctWithSetup}% of the first month (setup + monthly)`);
  } else {
    lines.push(
      `${plan.firstMonthPctWithSetup}% of the first month with a setup fee, ${plan.firstMonthPctWithoutSetup}% without`,
    );
  }
  const residual =
    plan.residualKind === "flat"
      ? `$${plan.residualValue}/month residual`
      : plan.residualKind === "percent"
        ? `${plan.residualValue}% of the monthly price as residual`
        : "No residual";
  lines.push(`${residual}, starting month 2`);
  lines.push(
    `Deals at $${plan.smallDealMaxMonthly}/mo or less: ${plan.smallDealFirstMonthPct}% of the first month, ${
      plan.smallDealGetsResidual ? "residual still paid" : "no residual"
    }`,
  );
  return lines;
}
