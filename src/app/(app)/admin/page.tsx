import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { duration, money, pct } from "@/lib/stats";
import { loadStats, rangeLabel } from "@/lib/stats-data";
import { createClient } from "@/lib/supabase/server";
import { Card, PageHeader } from "@/components/ui";
import { Funnel } from "@/components/stats/funnel";
import { Kpi } from "@/components/stats/kpi";
import { Leaderboard } from "@/components/stats/leaderboard";
import { LiveFloor } from "@/components/stats/live-floor";
import { RangePicker } from "@/components/stats/range-picker";
import { TrendChart } from "@/components/stats/trend-chart";
import { getFloor } from "./actions";

type InventoryRow = { list: "EAST" | "WEST" | null; ready_now: number; waiting: number; total: number };

export default async function AdminDashboard({ searchParams }: PageProps<"/admin">) {
  await requireAdmin();
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ range, reps, team, daily, query }, floor, { data: inv }] = await Promise.all([
    loadStats(sp),
    getFloor(),
    supabase.rpc("lead_inventory"),
  ]);
  const inventory = (inv ?? []) as InventoryRow[];
  const t = team;

  return (
    <>
      <PageHeader title="Dashboard" description={`Team numbers for ${rangeLabel(range)} (Eastern time)`} actions={<RangePicker current={range.key} fromDay={range.fromDay} toDay={range.toDay} />} />

      <Card className="mb-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-medium text-gray-900">Live floor</h2>
          <span className="text-xs text-gray-500">Updates every 10 seconds</span>
        </div>
        <LiveFloor initial={floor} />
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi hero label="Sales" value={t.sales} sub={`Close rate ${pct(t.sales, t.sales + t.pitched_no_sale)} · ${money(t.mrr)} MRR`} />
        <Kpi label="Dials" value={t.dials.toLocaleString()} sub={`${t.contacts.toLocaleString()} contacts · ${pct(t.contacts, t.dials)} contact rate`} />
        <Kpi label="Appointments set" value={t.appointments} sub={`${pct(t.appointments, t.contacts)} of contacts`} />
        <Kpi label="Demos" value={t.demos} sub={`Show rate ${pct(t.showed, t.showed + t.missed)} · ${t.pitched_no_sale} pitched, no sale`} />
        <Kpi label="Talk time" value={duration(t.talk_seconds)} sub={`Avg ${t.answered_calls ? duration(t.talk_seconds / t.answered_calls) : "—"} per answered call`} />
        <Kpi label="Logged in" value={duration(t.logged_in_seconds)} sub={`Not calling ${duration(Math.max(0, t.logged_in_seconds - t.on_call_seconds))}`} />
        <Kpi label="Paused" value={duration(t.paused_seconds)} sub={`Lunch ${duration(t.paused_lunch)} · Break ${duration(t.paused_break)} · Meeting ${duration(t.paused_meeting)}`} />
        <Kpi label="Commission" value={money(t.first_month_commission)} sub={`Residuals ${money(t.residual_commission)} (admin only)`} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_24rem]">
        <Card>
          <h2 className="mb-3 font-medium text-gray-900">By day</h2>
          <TrendChart rows={daily} />
        </Card>
        <Card>
          <h2 className="mb-4 font-medium text-gray-900">Team funnel</h2>
          <Funnel steps={[
            { label: "Dials", value: t.dials },
            { label: "Contacts", value: t.contacts },
            { label: "Appointments", value: t.appointments },
            { label: "Demos", value: t.demos },
            { label: "Sales", value: t.sales },
          ]} />
        </Card>
      </div>

      <Card className="mt-6 overflow-hidden p-0">
        <div className="px-6 pt-5 pb-3">
          <h2 className="font-medium text-gray-900">Leaderboard</h2>
          <p className="text-sm text-gray-500">Click a column to sort. Click a name for that rep&apos;s details.</p>
        </div>
        <Leaderboard rows={reps} team={team} isAdmin query={query} />
      </Card>

      <Card className="mt-6">
        <div className="flex items-center justify-between">
          <h2 className="font-medium text-gray-900">Lead inventory</h2>
          <Link href="/admin/leads" className="text-sm font-medium text-brand-600 hover:underline">Leads & bad-number rates →</Link>
        </div>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          {(["EAST", "WEST"] as const).map((l) => {
            const r = inventory.find((x) => x.list === l);
            return (
              <div key={l} className="rounded-lg bg-gray-50 p-4 ring-1 ring-gray-200">
                <p className="text-sm text-gray-500">{l}</p>
                <p className="text-2xl font-semibold text-gray-900">{Number(r?.ready_now ?? 0).toLocaleString()} <span className="text-sm font-normal text-gray-500">ready now</span></p>
                <p className="text-xs text-gray-500">{Number(r?.waiting ?? 0).toLocaleString()} waiting for retry · {Number(r?.total ?? 0).toLocaleString()} total</p>
              </div>
            );
          })}
        </div>
      </Card>
    </>
  );
}
