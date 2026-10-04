import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { formatPhone } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";
import { Card, PageHeader } from "@/components/ui";
import { normalize, resolveRange, type RepStats } from "@/lib/stats";
import { RepTodayTiles } from "./stats-tiles";
import { formatTime } from "@/lib/time";


type Upcoming = {
  id: string; starts_at: string;
  lead: { id: string; business_name: string; phone_e164: string | null } | null;
};

export default async function RepDashboard() {
  const profile = await requireUser();
  const firstName = profile.full_name.split(" ")[0] || "there";
  const supabase = await createClient();
  const { data } = await supabase
    .from("appointments")
    .select("id, starts_at, lead:leads(id, business_name, phone_e164)")
    .eq("rep_id", profile.id)
    .eq("status", "scheduled")
    .gte("ends_at", new Date().toISOString())
    .order("starts_at")
    .limit(8);
  const upcoming = (data ?? []) as unknown as Upcoming[];
  const today = resolveRange("today");
  const { data: statRows } = await supabase.rpc("rep_stats", { p_from: today.from.toISOString(), p_to: today.to.toISOString() });
  const mine = ((statRows ?? []) as RepStats[]).map(normalize).find((r) => r.rep_id === profile.id);

  return (
    <>
      <PageHeader title={`Hi ${firstName}`} description="Your day at a glance." />
      <RepTodayTiles r={mine} />
      <Card className="mt-6">
        <div className="flex items-center justify-between">
          <h2 className="font-medium text-gray-900">Upcoming appointments</h2>
          <Link href="/calendar" className="text-sm font-medium text-brand-600 hover:underline">Calendar →</Link>
        </div>
        {upcoming.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">Nothing booked yet. Appointments you set on the dialer show up here.</p>
        ) : (
          <ul className="mt-3 divide-y divide-gray-100 text-sm">
            {upcoming.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-gray-600">
                  {formatTime(a.starts_at, "short")}
                </span>
                {a.lead && (
                  <Link href={`/leads/${a.lead.id}`} className="font-medium text-gray-900 hover:underline">
                    {a.lead.business_name} <span className="font-normal text-gray-500">{formatPhone(a.lead.phone_e164)}</span>
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
