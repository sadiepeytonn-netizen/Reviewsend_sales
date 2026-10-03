import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { STATUS_LABELS, STATUS_TONES, type LeadStatus } from "@/lib/leads";
import { formatPhone } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, PageHeader } from "@/components/ui";

type Row = {
  id: string; business_name: string; contact_name: string | null; phone_e164: string | null; city: string | null;
  state: string | null; status: LeadStatus; last_called_at: string | null;
  appointments: { starts_at: string; status: string }[];
};

// The next scheduled appointment (including one that started within the last hour).
function nextAppt(l: Row) {
  const cutoff = Date.now() - 60 * 60_000;
  return l.appointments
    .filter((a) => a.status === "scheduled" && Date.parse(a.starts_at) > cutoff)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
}

export default async function MyLeadsPage() {
  const me = await requireUser();
  const supabase = await createClient();
  const { data } = await supabase
    .from("leads")
    .select("id, business_name, contact_name, phone_e164, city, state, status, last_called_at, appointments(starts_at, status)")
    .eq("owner_id", me.id)
    .order("updated_at", { ascending: false });
  const leads = (data ?? []) as Row[];

  return (
    <>
      <PageHeader title="My leads" description="Leads you booked or sold. They're yours. Nobody else can see or call them." />
      <Card className="overflow-x-auto p-0">
        {leads.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-gray-500">
            No leads yet. When you set an appointment or make a sale on the dialer, the lead shows up here.
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2 font-medium">Business</th>
                <th className="px-4 py-2 font-medium">Phone</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Next appointment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {leads.map((l) => {
                const appt = nextAppt(l);
                return (
                  <tr key={l.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2">
                      <Link href={`/leads/${l.id}`} className="font-medium text-gray-900 hover:underline">{l.business_name}</Link>
                      <p className="text-xs text-gray-500">{[l.contact_name, [l.city, l.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}</p>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-gray-600">{formatPhone(l.phone_e164)}</td>
                    <td className="px-4 py-2"><Badge tone={STATUS_TONES[l.status]}>{STATUS_LABELS[l.status]}</Badge></td>
                    <td className="whitespace-nowrap px-4 py-2 text-gray-600">
                      {appt ? new Date(appt.starts_at).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—"}
                    </td>
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
