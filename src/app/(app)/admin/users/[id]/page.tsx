import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { DEFAULT_PLAN, describePlan, planFromRow } from "@/lib/commission";
import { createClient } from "@/lib/supabase/server";
import type { CommissionPlanRow, Profile } from "@/lib/types";
import { Badge, Button, Card, PageHeader } from "@/components/ui";
import { setActive, setCoaching } from "../actions";
import { CommissionPlanForm } from "./commission-plan-form";
import { ProfileForm, ResetPasswordForm } from "./user-forms";
import { formatTime } from "@/lib/time";

const COACHING = [
  { field: "can_listen", label: "Listen", help: "Hear the call. Nobody on the call can tell." },
  { field: "can_whisper", label: "Whisper", help: "Talk to the rep only. The prospect can't hear." },
  { field: "can_barge", label: "Barge", help: "Join the call. Everyone hears." },
] as const;

export default async function UserPage({ params }: PageProps<"/admin/users/[id]">) {
  const { id } = await params;
  const me = await requireAdmin();
  const supabase = await createClient();

  const { data: userData } = await supabase.from("profiles").select("*").eq("id", id).maybeSingle();
  if (!userData) notFound();
  const user = userData as Profile;

  const { data: planData } = await supabase
    .from("commission_plans")
    .select("*")
    .eq("rep_id", id)
    .order("effective_from", { ascending: false });
  const plans = (planData ?? []) as CommissionPlanRow[];
  const current = plans[0] ? planFromRow(plans[0]) : DEFAULT_PLAN;
  const isSelf = me.id === user.id;

  return (
    <>
      <Link href="/admin/users" className="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900">
        <ArrowLeft className="h-4 w-4" /> All users
      </Link>
      <PageHeader
        title={user.full_name || user.email}
        description={user.email}
        actions={
          <div className="flex items-center gap-2">
            {user.active ? <Badge tone="green">Active</Badge> : <Badge tone="red">Turned off</Badge>}
            {!isSelf && (
              <form action={setActive}>
                <input type="hidden" name="userId" value={user.id} />
                <input type="hidden" name="active" value={user.active ? "false" : "true"} />
                <Button variant={user.active ? "danger" : "secondary"}>
                  {user.active ? "Turn off account" : "Turn account back on"}
                </Button>
              </form>
            )}
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
        <div className="space-y-6">
          <Card>
            <h2 className="mb-4 font-medium text-gray-900">Details</h2>
            <ProfileForm user={user} />
          </Card>
          {!isSelf && (
            <Card>
              <h2 className="mb-3 font-medium text-gray-900">Password</h2>
              <ResetPasswordForm userId={user.id} />
            </Card>
          )}
        </div>

        {user.role === "rep" && (
          <div className="space-y-6">
            {user.can_listen !== undefined && (
              <Card>
                <h2 className="font-medium text-gray-900">Listening in on calls</h2>
                <p className="mb-4 mt-1 text-sm text-gray-500">
                  What this rep may do on other reps&apos; live calls (for training). Reps never see that someone is listening.
                </p>
                <ul className="divide-y divide-gray-100">
                  {COACHING.map((c) => {
                    const on = Boolean(user[c.field]);
                    return (
                      <li key={c.field} className="flex items-center justify-between gap-4 py-3">
                        <div>
                          <p className="text-sm font-medium text-gray-900">{c.label}</p>
                          <p className="text-xs text-gray-500">{c.help}</p>
                        </div>
                        <form action={setCoaching} className="flex items-center gap-2">
                          <input type="hidden" name="userId" value={user.id} />
                          <input type="hidden" name="field" value={c.field} />
                          <input type="hidden" name="value" value={on ? "false" : "true"} />
                          {on ? <Badge tone="green">On</Badge> : <Badge>Off</Badge>}
                          <Button variant="secondary">{on ? "Turn off" : "Turn on"}</Button>
                        </form>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            )}
            <Card>
              <h2 className="font-medium text-gray-900">Commission plan</h2>
              <p className="mb-5 mt-1 text-sm text-gray-500">
                Only admins can see this. Changes apply to sales made after you save; past sales keep their old rate.
              </p>
              <CommissionPlanForm userId={user.id} current={current} />
            </Card>

            {plans.length > 0 && (
              <Card>
                <h2 className="mb-3 font-medium text-gray-900">Plan history</h2>
                <ul className="divide-y divide-gray-100 text-sm">
                  {plans.map((row, i) => (
                    <li key={row.id} className="py-3">
                      <p className="font-medium text-gray-900">
                        From {formatTime(row.effective_from)}
                        {i === 0 && <span className="ml-2"><Badge tone="blue">Current</Badge></span>}
                      </p>
                      <ul className="mt-1 list-disc pl-5 text-gray-600">
                        {describePlan(planFromRow(row)).map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        )}
      </div>
    </>
  );
}
