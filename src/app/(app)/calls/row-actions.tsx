"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FolderOpen, PencilLine, Phone, X } from "lucide-react";
import { Alert, Button, Card } from "@/components/ui";
import { formatPhone } from "@/lib/phone";
import { WrapUp } from "../dialer/wrap-up";
import { History, LeadDetails } from "../dialer/lead-panels";
import type { LeadContext } from "../dialer/actions";
import { changeCallOutcome, getCallLead } from "./actions";

function Modal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/30 p-4" onClick={onClose}>
      <div className="mx-auto my-6 max-w-3xl" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

/** "Pick outcome" (none yet) or "Change outcome": the same How-did-it-go form as after a call. */
export function OutcomeButton({ callId, missing, who, leadTimezone }: { callId: string; missing: boolean; who: string; leadTimezone: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <>
      <Button variant={missing ? "primary" : "secondary"} onClick={() => { setProblem(null); setOpen(true); }}>
        <PencilLine className="h-4 w-4" /> {missing ? "Pick outcome" : "Change outcome"}
      </Button>
      {open && (
        <Modal onClose={() => setOpen(false)}>
          <div className="mb-2 flex items-center justify-between rounded-t-lg bg-white px-4 py-2 text-sm text-gray-700">
            <span>Call with <b>{who}</b></span>
            <button onClick={() => setOpen(false)} className="rounded p-1 text-gray-400 hover:bg-gray-100" aria-label="Close"><X className="h-5 w-5" /></button>
          </div>
          {problem && <div className="mb-2"><Alert>{problem}</Alert></div>}
          <WrapUp
            busy={busy}
            hadCall
            leadTimezone={leadTimezone}
            showPauseAfter={false}
            onBack={() => setOpen(false)}
            onSubmit={async (d) => {
              setBusy(true);
              const res = await changeCallOutcome({
                callId,
                disposition: d.disposition,
                note: d.note,
                appointmentStart: d.appointmentStart ?? null,
                appointmentMinutes: d.appointmentMinutes ?? null,
              });
              setBusy(false);
              if (res.error) return setProblem(res.error);
              setOpen(false);
              router.refresh();
            }}
          />
        </Modal>
      )}
    </>
  );
}

/** "Open lead" for reps: details, notes and every call, plus Call now if the lead is theirs. */
export function OpenLeadButton({ callId }: { callId: string }) {
  const [data, setData] = useState<{ context: LeadContext; canCall: boolean } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  return (
    <>
      <Button
        variant="secondary"
        disabled={loading}
        onClick={async () => {
          setLoading(true);
          const res = await getCallLead(callId);
          setLoading(false);
          if (res.error || !res.context) return setProblem(res.error ?? "Couldn't open the lead.");
          setProblem(null);
          setData({ context: res.context, canCall: Boolean(res.canCall) });
        }}
      >
        <FolderOpen className="h-4 w-4" /> {loading ? "Opening…" : "Open lead"}
      </Button>
      {problem && <span className="text-xs text-red-600">{problem}</span>}
      {data && (
        <Modal onClose={() => setData(null)}>
          <Card>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-2xl font-bold text-gray-900">{data.context.lead.contact_name || "Owner unknown"}</p>
                <p className="text-gray-700">
                  {data.context.lead.business_name} · <span className="font-mono">{formatPhone(data.context.lead.phone_e164 ?? "")}</span>
                </p>
              </div>
              <button onClick={() => setData(null)} className="rounded p-1 text-gray-400 hover:bg-gray-100" aria-label="Close"><X className="h-5 w-5" /></button>
            </div>
            {data.canCall && (
              <Link href={`/dialer?lead=${data.context.lead.id}`} className="mt-3 inline-block">
                <Button className="bg-green-600 hover:bg-green-700"><Phone className="h-4 w-4" /> Call now</Button>
              </Link>
            )}
          </Card>
          <div className="mt-3"><LeadDetails lead={data.context.lead} /></div>
          <Card className="mt-3">
            <h3 className="font-semibold text-gray-900">Notes and calls</h3>
            <History notes={data.context.notes} calls={data.context.calls} />
          </Card>
        </Modal>
      )}
    </>
  );
}
