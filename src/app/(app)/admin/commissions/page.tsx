import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { money } from "@/lib/stats";
import { formatTime } from "@/lib/time";
import { createClient } from "@/lib/supabase/server";
import { Badge, Button, Card, PageHeader } from "@/components/ui";
import { setPaidOut } from "./actions";

type Row = {
  id: string; rep_id: string; kind: "first_month" | "residual"; period_start: string; amount: number;
  explanation: string; paid_out_at: string | null;
  rep: { full_name: string; email: string } | null;
  sale: { business_name: string | null } | null;
};

function shiftMonth(month: string, n: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

export default async function CommissionsPage({ searchParams }: PageProps<"/admin/commissions">) {
  await requireAdmin();
  const sp = await searchParams;
  const now = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }).slice(0, 7);
  const month = typeof sp.month === "string" && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : now;
  const supabase = await createClient();
  const { data } = await supabase
    .from("commissions")
    .select("id, rep_id, kind, period_start, amount, explanation, paid_out_at, rep:profiles!commissions_rep_id_fkey(full_name, email), sale:sales(business_name)")
    .gte("period_start", `${month}-01`)
    .lt("period_start", `${shiftMonth(month, 1)}-01`)
    .order("period_start");
  const rows = (data ?? []) as unknown as Row[];

  const byRep = new Map<string, { name: string; first: number; residual: number; unpaid: number; rows: Row[] }>();
  for (const r of rows) {
    const e = byRep.get(r.rep_id) ?? { name: r.rep?.full_name || r.rep?.email || "", first: 0, residual: 0, unpaid: 0, rows: [] };
    if (r.kind === "first_month") e.first += Number(r.amount);
    else e.residual += Number(r.amount);
    if (!r.paid_out_at) e.unpaid += Number(r.amount);
    e.rows.push(r);
    byRep.set(r.rep_id, e);
  }
  const label = new Date(`${month}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <>
      <PageHeader
        title="Commissions"
        description="What each rep earned, from paid Stripe invoices. Only admins can see residuals."
        actions={
          <div className="flex items-center gap-2">
            <Link href={`?month=${shiftMonth(month, -1)}`}><Button variant="ghost" aria-label="Previous month"><ChevronLeft className="h-4 w-4" /></Button></Link>
            <span className="w-36 text-center font-semibold text-gray-900">{label}</span>
            <Link href={`?month=${shiftMonth(month, 1)}`}><Button variant="ghost" aria-label="Next month"><ChevronRight className="h-4 w-4" /></Button></Link>
          </div>
        }
      />
      {byRep.size === 0 ? (
        <Card><p className="text-center text-sm text-gray-500">No commission earned in {label}.</p></Card>
      ) : (
        <div className="space-y-6">
          {[...byRep.entries()].map(([repId, e]) => (
            <Card key={repId} className="overflow-hidden p-0">
              <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
                <div>
                  <h2 className="font-semibold text-gray-900">{e.name}</h2>
                  <p className="text-sm text-gray-600">
                    First month {money(e.first)} · Residuals {money(e.residual)} · <b>Total {money(e.first + e.residual)}</b>
                  </p>
                </div>
                <form action={setPaidOut} className="flex items-center gap-3">
                  <input type="hidden" name="repId" value={repId} />
                  <input type="hidden" name="month" value={month} />
                  {e.unpaid > 0 ? (
                    <>
                      <span className="text-sm text-amber-800">{money(e.unpaid)} unpaid</span>
                      <input type="hidden" name="paid" value="true" />
                      <Button type="submit">Mark paid out</Button>
                    </>
                  ) : (
                    <>
                      <Badge tone="green">Paid out</Badge>
                      <input type="hidden" name="paid" value="false" />
                      <Button type="submit" variant="ghost" className="text-xs">Undo</Button>
                    </>
                  )}
                </form>
              </div>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-gray-100 border-t border-gray-100">
                  {e.rows.map((r) => (
                    <tr key={r.id}>
                      <td className="px-6 py-2 text-gray-600">{formatTime(`${r.period_start}T16:00:00Z`, "date")}</td>
                      <td className="px-6 py-2 font-medium text-gray-900">{r.sale?.business_name}</td>
                      <td className="px-6 py-2"><Badge tone={r.kind === "first_month" ? "blue" : "gray"}>{r.kind === "first_month" ? "First month" : "Residual"}</Badge></td>
                      <td className="px-6 py-2 text-gray-500">{r.explanation}</td>
                      <td className="px-6 py-2 text-right font-medium tabular-nums">{money(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
