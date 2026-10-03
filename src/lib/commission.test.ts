import { describe, expect, it } from "vitest";
import { PLAN_TEMPLATES, firstMonthCommission, monthlyResidual } from "./commission";

const { standard: nate, ryan, corban } = Object.fromEntries(
  Object.entries(PLAN_TEMPLATES).map(([k, v]) => [k, v.plan]),
);

describe("Nate (standard plan)", () => {
  it("40% of first month and $75 residual over $199", () => {
    expect(firstMonthCommission(nate, 500, 299).amount).toBe(319.6);
    expect(monthlyResidual(nate, 299)).toBe(75);
  });
  it("$199 deal: 40%, no residual", () => {
    expect(firstMonthCommission(nate, 0, 199).amount).toBe(79.6);
    expect(monthlyResidual(nate, 199)).toBe(0);
  });
});

describe("Ryan", () => {
  it("50% even on a $199 deal, no residual at $199", () => {
    expect(firstMonthCommission(ryan, 300, 199).amount).toBe(249.5);
    expect(monthlyResidual(ryan, 199)).toBe(0);
  });
  it("$100 residual over $199", () => {
    expect(firstMonthCommission(ryan, 0, 249).amount).toBe(124.5);
    expect(monthlyResidual(ryan, 249)).toBe(100);
  });
});

describe("Corban", () => {
  it("50% with setup fee, 40% without", () => {
    expect(firstMonthCommission(corban, 500, 299).pct).toBe(50);
    expect(firstMonthCommission(corban, 0, 299).pct).toBe(40);
  });
  it("30% residual over $199, none at $199 (and 40% even with a setup fee)", () => {
    expect(monthlyResidual(corban, 299)).toBe(89.7);
    expect(monthlyResidual(corban, 199)).toBe(0);
    expect(firstMonthCommission(corban, 500, 199).pct).toBe(40);
  });
});
