import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { twilioConfig } from "@/lib/twilio";
import { paymentSetup } from "@/lib/payment-setup";
import { PageHeader } from "@/components/ui";
import { loadLeadContext } from "./actions";
import { Competition } from "./competition";
import { Dialer } from "./dialer";

export default async function DialerPage({ searchParams }: PageProps<"/dialer">) {
  const me = await requireUser();
  const { lead } = await searchParams;
  const c = twilioConfig();
  const payments = await paymentSetup(me);

  // ?lead=… calls one of the rep's own leads (appointments, follow-ups) outside the queue.
  let single = undefined;
  if (typeof lead === "string") {
    single = await loadLeadContext(lead);
    if (!single || (single.lead.owner_id !== me.id && me.role !== "admin")) notFound();
  }

  return (
    <>
      <PageHeader title={single ? "Call lead" : "Dialer"} />
      <Competition />
      <Dialer callingReady={c.ready} callingProblem={c.ready ? undefined : "Twilio settings missing"} singleLead={single} payments={payments} />
    </>
  );
}
