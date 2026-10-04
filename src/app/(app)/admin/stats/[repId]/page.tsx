import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { duration, money, pct } from "@/lib/stats";
import { loadStats, rangeLabel } from "@/lib/stats-data";
import { Card, PageHeader } from "@/components/ui";
import { Funnel } from "@/components/stats/funnel";
import { Kpi } from "@/components/stats/kpi";
import { RangePicker } from "@/components/stats/range-picker";
import { TrendChart } from "@/components/stats/trend-chart";

export default async function RepStatsPage({ params, searchParams }: PageProps<"/admin/stats/[repId]">) {
  await requireAdmin();
  const { repId } = await params;
  const { range, reps, daily } = await loadStats(await searchParams, repId);
  const r = reps.find((x) => x.rep_id === repId);
  if (!r) notFound();

  const timeRows: [string, number][] = [
    ["On calls", r.on_call_seconds],
    ["Between calls", r.ready_seconds],
    ["Wrapping up", r.wrap_up_seconds],
    ["Online, not dialing", r.idle_seconds],
    ["Paused: lunch", r.paused_lunch],
    ["Paused: break", r.paused_break],
    ["Paused: meeting", r.paused_meeting],
    ["Paused: training", r.paused_training],
    ["Paused: other", r.paused_other],
  ];

  return (
    <>
      <Link href="/admin" className="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900">
        <ArrowLeft className="h-4 w-4" /> Dashboard
      </Link>
      <PageHeader title={r.rep_name} description={rangeLabel(range)} actions={<RangePicker current={range.key} fromDay={range.fromDay} toDay={range.toDay} />} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi hero label="Sales" value={r.sales} sub={`Close rate ${pct(r.sales, r.sales + r.pitched_no_sale)} · ${money(r.mrr)} MRR`} />
        <Kpi label="Dials" value={r.dials} sub={`${r.contacts} contacts · ${pct(r.contacts, r.dials)}`} />
        <Kpi label="Appointments" value={r.appointments} sub={`${pct(r.appointments, r.contacts)} of contacts · show rate ${pct(r.showed, r.showed + r.missed)}`} />
        <Kpi label="Commission" value={money(r.first_month_commission)} sub={`Residuals ${money(r.residual_commission)}`} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-4 font-medium text-gray-900">Funnel</h2>
          <Funnel steps={[
            { label: "Dials", value: r.dials },
            { label: "Contacts", value: r.contacts },
            { label: "Appointments", value: r.appointments },
            { label: "Demos", value: r.demos },
            { label: "Sales", value: r.sales },
          ]} />
          <p className="mt-3 text-sm text-gray-600">{r.pitched_no_sale} pitched, no sale · {r.missed} demo{r.missed === 1 ? "" : "s"} missed</p>
        </Card>
        <Card>
          <h2 className="mb-3 font-medium text-gray-900">Where the time went</h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <dt className="text-gray-500">Logged in</dt><dd className="text-right font-semibold tabular-nums">{duration(r.logged_in_seconds)}</dd>
            <dt className="text-gray-500">Talk time</dt><dd className="text-right tabular-nums">{duration(r.talk_seconds)} ({r.answered_calls ? duration(r.talk_seconds / r.answered_calls) : "—"} avg)</dd>
            <dt className="text-gray-500">Avg between calls</dt><dd className="text-right tabular-nums">{duration(r.avg_gap_seconds)}</dd>
            <dt className="text-gray-500">Not calling</dt><dd className="text-right tabular-nums">{duration(Math.max(0, r.logged_in_seconds - r.on_call_seconds))}</dd>
            {timeRows.filter(([, v]) => v > 0).map(([k, v]) => (
              <div key={k} className="contents"><dt className="text-gray-500">{k}</dt><dd className="text-right tabular-nums">{duration(v)}</dd></div>
            ))}
          </dl>
        </Card>
      </div>

      <Card className="mt-6">
        <h2 className="mb-3 font-medium text-gray-900">Trend</h2>
        <TrendChart rows={daily} />
      </Card>
    </>
  );
}
