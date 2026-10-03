"use client";

import { useActionState, useState } from "react";
import { Alert, Button, Field, Input, Select } from "@/components/ui";
import {
  PLAN_TEMPLATES,
  firstMonthCommission,
  monthlyResidual,
  type CommissionPlan,
} from "@/lib/commission";
import { saveCommissionPlan, type ActionState } from "../actions";

const EXAMPLES = [
  { setup: 500, monthly: 299 },
  { setup: 0, monthly: 299 },
  { setup: 300, monthly: 199 },
];

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export function CommissionPlanForm({ userId, current }: { userId: string; current: CommissionPlan }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(saveCommissionPlan, {});
  const [plan, setPlan] = useState<CommissionPlan>(current);
  // Remount inputs when a template is applied so they show the new values.
  const [formKey, setFormKey] = useState(0);

  const set = <K extends keyof CommissionPlan>(key: K, value: CommissionPlan[K]) =>
    setPlan((p) => ({ ...p, [key]: value }));
  const num = (v: string) => (v === "" ? 0 : Number(v));

  return (
    <div className="space-y-5">
      {state.error && <Alert>{state.error}</Alert>}
      {state.success && <Alert tone="green">{state.success}</Alert>}

      <Field label="Start from a template (optional)" htmlFor="template">
        <Select
          id="template"
          defaultValue=""
          onChange={(e) => {
            const t = PLAN_TEMPLATES[e.target.value];
            if (t) {
              setPlan(t.plan);
              setFormKey((k) => k + 1);
            }
          }}
        >
          <option value="">— Choose —</option>
          {Object.entries(PLAN_TEMPLATES).map(([key, t]) => (
            <option key={key} value={key}>
              {t.label}
            </option>
          ))}
        </Select>
      </Field>

      <form key={formKey} action={formAction} className="space-y-5">
        <input type="hidden" name="userId" value={userId} />

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-semibold text-gray-900">First month (setup fee + first monthly payment)</legend>
          <Field label="% when there IS a setup fee" htmlFor="firstMonthPctWithSetup">
            <Input id="firstMonthPctWithSetup" name="firstMonthPctWithSetup" type="number" step="0.01" min="0" max="100"
              defaultValue={plan.firstMonthPctWithSetup} onChange={(e) => set("firstMonthPctWithSetup", num(e.target.value))} required />
          </Field>
          <Field label="% when there is NO setup fee" htmlFor="firstMonthPctWithoutSetup">
            <Input id="firstMonthPctWithoutSetup" name="firstMonthPctWithoutSetup" type="number" step="0.01" min="0" max="100"
              defaultValue={plan.firstMonthPctWithoutSetup} onChange={(e) => set("firstMonthPctWithoutSetup", num(e.target.value))} required />
          </Field>
        </fieldset>

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-semibold text-gray-900">Monthly residual (month 2 onward, while the client pays)</legend>
          <Field label="Type" htmlFor="residualKind">
            <Select id="residualKind" name="residualKind" defaultValue={plan.residualKind}
              onChange={(e) => set("residualKind", e.target.value as CommissionPlan["residualKind"])}>
              <option value="none">No residual</option>
              <option value="flat">Flat dollars per month</option>
              <option value="percent">Percent of monthly price</option>
            </Select>
          </Field>
          {plan.residualKind !== "none" && (
            <Field label={plan.residualKind === "flat" ? "Dollars per month" : "Percent of monthly price"} htmlFor="residualValue">
              <Input id="residualValue" name="residualValue" type="number" step="0.01" min="0"
                defaultValue={plan.residualValue} onChange={(e) => set("residualValue", num(e.target.value))} required />
            </Field>
          )}
        </fieldset>

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-semibold text-gray-900">Small deals</legend>
          <Field label="Monthly price at or below ($)" htmlFor="smallDealMaxMonthly">
            <Input id="smallDealMaxMonthly" name="smallDealMaxMonthly" type="number" step="0.01" min="0"
              defaultValue={plan.smallDealMaxMonthly} onChange={(e) => set("smallDealMaxMonthly", num(e.target.value))} required />
          </Field>
          <Field label="First month % on small deals" htmlFor="smallDealFirstMonthPct">
            <Input id="smallDealFirstMonthPct" name="smallDealFirstMonthPct" type="number" step="0.01" min="0" max="100"
              defaultValue={plan.smallDealFirstMonthPct} onChange={(e) => set("smallDealFirstMonthPct", num(e.target.value))} required />
          </Field>
          <label className="flex items-center gap-2 text-sm text-gray-700 sm:col-span-2">
            <input type="checkbox" name="smallDealGetsResidual" defaultChecked={plan.smallDealGetsResidual}
              onChange={(e) => set("smallDealGetsResidual", e.target.checked)} className="h-4 w-4 rounded border-gray-300" />
            Small deals still earn the monthly residual
          </label>
        </fieldset>

        <div className="rounded-lg bg-gray-50 p-4 ring-1 ring-gray-200">
          <p className="mb-2 text-sm font-semibold text-gray-900">What this plan pays</p>
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-500">
              <tr>
                <th className="py-1 text-left font-medium">Deal</th>
                <th className="py-1 text-right font-medium">First month</th>
                <th className="py-1 text-right font-medium">Residual / mo</th>
              </tr>
            </thead>
            <tbody>
              {EXAMPLES.map(({ setup, monthly }) => {
                const first = firstMonthCommission(plan, setup, monthly);
                return (
                  <tr key={`${setup}-${monthly}`} className="border-t border-gray-200">
                    <td className="py-1.5 text-gray-700">
                      {setup ? `${money(setup)} setup + ` : "No setup + "}
                      {money(monthly)}/mo
                    </td>
                    <td className="py-1.5 text-right font-medium">
                      {money(first.amount)} <span className="text-xs text-gray-500">({first.pct}%)</span>
                    </td>
                    <td className="py-1.5 text-right font-medium">{money(monthlyResidual(plan, monthly))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save plan"}
        </Button>
      </form>
    </div>
  );
}
