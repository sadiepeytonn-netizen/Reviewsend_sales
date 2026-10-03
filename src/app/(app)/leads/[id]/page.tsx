import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Phone } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { STATUS_LABELS, STATUS_TONES, timezoneLabel } from "@/lib/leads";
import { formatPhone } from "@/lib/phone";
import { Badge, Button, Card, PageHeader } from "@/components/ui";
import { loadLeadContext } from "../../dialer/actions";
import { LeadDetails, PastCalls } from "../../dialer/lead-panels";
import { LeadNotes } from "./lead-notes";
import { createClient } from "@/lib/supabase/server";

const APPT_LABELS: Record<string, string> = {
  scheduled: "Scheduled", showed: "Showed", missed: "Demo missed", canceled: "Canceled", rescheduled: "Rescheduled",
};

// A rep's view of one of their leads (admins can open any lead here too).
export default async function LeadPage({ params }: PageProps<"/leads/[id]">) {
  const { id } = await params;
  const me = await requireUser();
  const ctx = await loadLeadContext(id);
  if (!ctx) notFound();
  const { lead } = ctx;

  const supabase = await createClient();
  const { data: appts } = await supabase
    .from("appointments")
    .select("id, starts_at, ends_at, status")
    .eq("lead_id", id)
    .order("starts_at", { ascending: false });

  const canCall = lead.owner_id === me.id || me.role === "admin";

  return (
    <>
      <Link href={me.role === "admin" ? "/admin/leads" : "/my-leads"} className="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900">
        <ArrowLeft className="h-4 w-4" /> {me.role === "admin" ? "Leads" : "My leads"}
      </Link>
      <PageHeader
        title={lead.business_name}
        description={`${formatPhone(lead.phone_e164)} · ${[lead.contact_name, [lead.city, lead.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ")} · ${timezoneLabel(lead.timezone)}`}
        actions={
          <div className="flex items-center gap-3">
            <Badge tone={STATUS_TONES[lead.status]}>{STATUS_LABELS[lead.status]}</Badge>
            {canCall && lead.status !== "do_not_call" && (
              <Link href={`/dialer?lead=${lead.id}`}>
                <Button className="bg-green-600 hover:bg-green-700"><Phone className="h-4 w-4" /> Call</Button>
              </Link>
            )}
          </div>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
        <div className="space-y-6">
          <LeadDetails lead={lead} />
          {(appts ?? []).length > 0 && (
            <Card>
              <h3 className="mb-3 font-medium text-gray-900">Appointments</h3>
              <ul className="divide-y divide-gray-100 text-sm">
                {(appts ?? []).map((a) => (
                  <li key={a.id} className="flex items-center justify-between py-2">
                    <span>{new Date(a.starts_at).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                    <Badge tone={a.status === "scheduled" ? "blue" : a.status === "showed" ? "green" : a.status === "missed" ? "red" : "gray"}>
                      {APPT_LABELS[a.status] ?? a.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
        <div className="space-y-6">
          <LeadNotes leadId={lead.id} initial={ctx.notes} />
          <PastCalls calls={ctx.calls} allowDownload={me.role === "admin"} />
        </div>
      </div>
    </>
  );
}
