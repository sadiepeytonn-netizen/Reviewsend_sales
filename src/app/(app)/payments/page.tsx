import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { paymentSetup } from "@/lib/payment-setup";
import { money } from "@/lib/stats";
import { formatTime } from "@/lib/time";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, PageHeader } from "@/components/ui";
import { ConfirmButton } from "@/components/confirm-button";
import { cancelSubscription } from "./actions";
import { NewPayment } from "./new-payment";

type Row = {
  id: string; business_name: string | null; contact_name: string | null; setup_fee: number; monthly_price: number;
  status: "pending" | "active" | "past_due" | "canceled"; source: string; payment_method: string | null;
  first_paid_at: string | null; created_at: string; lead_id: string | null; last_error: string | null;
  rep: { full_name: string; email: string } | null;
  commissions: { kind: string; amount: number }[];
};

const STATUS: Record<Row["status"], { label: string; tone: "gray" | "green" | "amber" | "red" | "blue" }> = {
  pending: { label: "Waiting for payment", tone: "amber" },
  active: { label: "Paid · active", tone: "green" },
  past_due: { label: "Past due", tone: "red" },
  canceled: { label: "Canceled", tone: "gray" },
};

export default async function PaymentsPage() {
  const me = await requireUser();
  const setup = await paymentSetup(me);
  const supabase = await createClient();
  const { data } = await supabase
    .from("sales")
    .select("id, business_name, contact_name, setup_fee, monthly_price, status, source, payment_method, first_paid_at, created_at, lead_id, last_error, rep:profiles!sales_rep_id_fkey(full_name, email), commissions(kind, amount)")
    .order("created_at", { ascending: false })
    .limit(200);
  const rows = (data ?? []) as unknown as Row[];

  return (
    <>
      <PageHeader
        title="Payments"
        description={setup.isAdmin ? "Take a payment for any rep, and see every sale." : "Take a payment while the client is on the phone, and see your sales."}
      />
      <div className="mb-6"><NewPayment setup={setup} /></div>

      <Card className="overflow-x-auto p-0">
        {rows.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-gray-500">No payments yet.</p>
        ) : (
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2 font-medium">Client</th>
                {setup.isAdmin && <th className="px-4 py-2 font-medium">Rep</th>}
                <th className="px-4 py-2 text-right font-medium">Setup</th>
                <th className="px-4 py-2 text-right font-medium">Monthly</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Paid</th>
                <th className="px-4 py-2 text-right font-medium">Commission</th>
                {setup.isAdmin && <th className="px-4 py-2 text-right font-medium">Residuals</th>}
                {setup.isAdmin && <th className="px-4 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r) => {
                const first = r.commissions.filter((c) => c.kind === "first_month").reduce((a, c) => a + Number(c.amount), 0);
                const resid = r.commissions.filter((c) => c.kind === "residual").reduce((a, c) => a + Number(c.amount), 0);
                return (
                  <tr key={r.id} className="align-top">
                    <td className="px-4 py-2">
                      {r.lead_id ? (
                        <Link href={`/leads/${r.lead_id}`} className="font-medium text-gray-900 hover:underline">{r.business_name}</Link>
                      ) : <span className="font-medium text-gray-900">{r.business_name}</span>}
                      <p className="text-xs text-gray-500">{r.contact_name}{r.source === "manual" ? " · recorded manually" : ""}</p>
                      {r.status === "pending" && r.last_error && <p className="text-xs text-red-600">{r.last_error}</p>}
                    </td>
                    {setup.isAdmin && <td className="px-4 py-2 text-gray-700">{r.rep?.full_name || r.rep?.email}</td>}
                    <td className="px-4 py-2 text-right tabular-nums">{money(r.setup_fee)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{money(r.monthly_price)}</td>
                    <td className="px-4 py-2"><Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge></td>
                    <td className="px-4 py-2 whitespace-nowrap text-gray-600">{r.first_paid_at ? formatTime(r.first_paid_at, "date") : "—"}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{first ? money(first) : "—"}</td>
                    {setup.isAdmin && <td className="px-4 py-2 text-right tabular-nums">{resid ? money(resid) : "—"}</td>}
                    {setup.isAdmin && (
                      <td className="px-4 py-2 text-right">
                        {(r.status === "active" || r.status === "past_due") && r.source === "stripe" && (
                          <form action={cancelSubscription}>
                            <input type="hidden" name="saleId" value={r.id} />
                            <ConfirmButton variant="ghost" className="px-2 py-1 text-xs text-red-700" message={`Cancel ${r.business_name}'s subscription? Stripe stops charging them and residuals stop.`}>
                              Cancel
                            </ConfirmButton>
                          </form>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
