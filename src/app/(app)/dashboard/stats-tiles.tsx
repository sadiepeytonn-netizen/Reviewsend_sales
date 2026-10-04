import { money, pct, type RepStats } from "@/lib/stats";
import { Kpi } from "@/components/stats/kpi";

export function RepTodayTiles({ r }: { r: RepStats | undefined }) {
  const z = (n: number | undefined) => n ?? 0;
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
      <Kpi label="Dials today" value={z(r?.dials)} />
      <Kpi label="Contacts" value={z(r?.contacts)} sub={r ? `${pct(r.contacts, r.dials)} contact rate` : undefined} />
      <Kpi label="Appointments" value={z(r?.appointments)} />
      <Kpi label="Sales" value={z(r?.sales)} />
      <Kpi label="Commission earned" value={money(r?.first_month_commission ?? 0)} />
    </div>
  );
}
