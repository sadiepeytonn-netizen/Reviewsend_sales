import "server-only";
import { createClient } from "@/lib/supabase/server";
import { normalize, resolveRange, teamTotals, type RepStats } from "@/lib/stats";
import type { DailyRow } from "@/components/stats/trend-chart";

type Params = { [k: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Reads the date range from the URL and loads per-rep stats + daily trend. */
export async function loadStats(searchParams: Params, repId?: string) {
  const range = resolveRange(one(searchParams.range), one(searchParams.from), one(searchParams.to));
  // A one-day view still shows a trend for the last 14 days.
  const trendFrom = range.fromDay === range.toDay ? addDaysLocal(range.toDay, -13) : range.fromDay;
  const supabase = await createClient();
  const [{ data: rows, error }, { data: daily }] = await Promise.all([
    supabase.rpc("rep_stats", { p_from: range.from.toISOString(), p_to: range.to.toISOString() }),
    supabase.rpc("daily_stats", { p_from: trendFrom, p_to: range.toDay, p_rep: repId ?? null }),
  ]);
  if (error) throw new Error(error.message);
  const reps = ((rows ?? []) as RepStats[]).map(normalize);
  const query = `?${new URLSearchParams(Object.entries({ range: range.key, from: range.key === "custom" ? range.fromDay : "", to: range.key === "custom" ? range.toDay : "" }).filter(([, v]) => v)).toString()}`;
  return { range, reps, team: teamTotals(reps), daily: (daily ?? []) as DailyRow[], query };
}

function addDaysLocal(day: string, n: number) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function rangeLabel(r: { key: string; fromDay: string; toDay: string }) {
  const f = (d: string) => {
    const [y, m, dd] = d.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  };
  return r.fromDay === r.toDay ? f(r.fromDay) : `${f(r.fromDay)} – ${f(r.toDay)}`;
}
