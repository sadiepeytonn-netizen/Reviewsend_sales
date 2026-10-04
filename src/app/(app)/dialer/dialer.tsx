"use client";

import { useEffect, useRef, useState } from "react";
import { Coffee, CreditCard, Grid3x3, Mic, MicOff, Pause, Phone, PhoneOff, Play, Square, X } from "lucide-react";
import type { PaymentSetup } from "@/lib/payment-setup";
import { PaymentFlow } from "../payments/payment-flow";
import { Alert, Badge, Button, Card, Select } from "@/components/ui";
import { formatPhone } from "@/lib/phone";
import { STATUS_LABELS, STATUS_TONES, timezoneLabel } from "@/lib/leads";
import type { LeadContext } from "./actions";
import { mmss, PAUSE_LABELS, useClock, useDialer, type Phase, type PauseReason } from "@/components/call/dialer-provider";
import { LeadDetails, NotesPanel, PastCalls } from "./lead-panels";
import { KeypadPanel, OwnerName, PhoneTools, SaveNewNumber } from "./keypad";
import { WrapUp } from "./wrap-up";

export function Dialer({
  callingReady,
  callingProblem,
  singleLead,
  payments,
}: {
  callingReady: boolean;
  callingProblem?: string;
  payments: PaymentSetup;
  /** Calling one of the rep's own leads (from My leads), not the queue. */
  singleLead?: LeadContext;
}) {
  // All call/session state lives in DialerProvider (app layout), so it
  // survives moving to other pages mid-call. This component only draws it.
  const d = useDialer();
  const { phase, list, ctx, error, callId, callState, answeredAt, muted, pauseReason, pausedAt, busy, paying, mode, manualPhone } = d;
  const [showKeypad, setShowKeypad] = useState(false);
  const now = useClock(callState === "open" || phase === "paused" || phase === "empty");

  // Opening /dialer?lead=… switches to that lead (unless a call is in progress).
  const started = useRef<string | null>(null);
  useEffect(() => {
    if (!singleLead || started.current === singleLead.lead.id) return;
    started.current = singleLead.lead.id;
    if (d.ctx?.lead.id !== singleLead.lead.id) d.startSingle(singleLead);
  }, [singleLead, d]);

  const single = mode === "single";
  const manual = mode === "manual";
  const call = d.call;
  const hangUp = d.hangUp;
  const toggleMute = d.toggleMute;
  const startDialing = () => d.startDialing(callingReady);
  const stopDialing = d.stopDialing;
  const pause = d.pause;
  const resume = d.resume;
  const loadNext = d.loadNext;
  const setList = d.setList;
  const setPauseReason = d.setPauseReason;
  const setPhase = d.setPhase;
  const setPaying = d.setPaying;
  const submitDisposition = d.submitDisposition;
  const onAddNote = d.addNote;

  // ---- Render --------------------------------------------------------------
  const callControls = (
    <>
      <Button onClick={hangUp} className="bg-red-600 px-6 py-3 text-base hover:bg-red-700">
        <PhoneOff className="h-5 w-5" /> Hang up
      </Button>
      <Button variant="secondary" onClick={toggleMute} disabled={callState !== "open"}>
        {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />} {muted ? "Unmute" : "Mute"}
      </Button>
      <Button variant="secondary" onClick={() => setShowKeypad((v) => !v)} disabled={callState !== "open"}>
        <Grid3x3 className="h-4 w-4" /> Keypad
      </Button>
      <span className="ml-2 font-mono text-lg text-gray-700">
        {callState === "open" && answeredAt ? mmss(now - answeredAt) : callState === "ringing" ? "Ringing…" : "Connecting…"}
      </span>
    </>
  );
  const dtmfPad = (
    <div className="mt-4 grid w-48 grid-cols-3 gap-2">
      {["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"].map((k) => (
        <button
          key={k}
          onClick={() => d.sendDigits(k)}
          className="rounded-lg bg-gray-100 py-2 text-lg font-semibold text-gray-800 hover:bg-gray-200"
        >
          {k}
        </button>
      ))}
    </div>
  );
  const lead = ctx?.lead;
  const onCall = phase === "calling";

  return (
    <div className="space-y-4">
      {!callingReady && (
        <Alert tone="amber">
          Phone calls aren&apos;t connected yet{callingProblem ? ` (${callingProblem})` : ""}. You can still try the
          dialer: load leads, add notes, and pick outcomes without calling.
        </Alert>
      )}

      {/* Top bar */}
      {!single && (
        <Card className="flex flex-wrap items-center gap-3 p-4">
          {phase === "idle" ? (
            <>
              <div className="flex rounded-lg bg-gray-100 p-1">
                {(["EAST", "WEST"] as const).map((l) => (
                  <button
                    key={l}
                    onClick={() => setList(l)}
                    className={`rounded-md px-4 py-1.5 text-sm font-semibold transition ${list === l ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}
                  >
                    {l}
                  </button>
                ))}
              </div>
              <span className="text-sm text-gray-500">{list === "EAST" ? "Eastern + Central" : "Mountain, Pacific, Alaska, Hawaii"}</span>
              <Button className="ml-auto" onClick={startDialing} disabled={busy}>
                <Play className="h-4 w-4" /> Start dialing
              </Button>
            </>
          ) : (
            <>
              <Badge tone="blue">{list}</Badge>
              <StatusPill phase={phase} callState={callState} pauseReason={pauseReason} />
              {manual && <Badge tone="gray">Keypad call</Badge>}
              <div className="ml-auto flex flex-wrap items-center gap-2">
                {(phase === "lead" || phase === "empty") && !manual && (
                  <>
                    <Select value={pauseReason} onChange={(e) => setPauseReason(e.target.value as PauseReason)} aria-label="Pause reason" className="w-32">
                      {Object.entries(PAUSE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </Select>
                    <Button variant="secondary" onClick={pause}><Pause className="h-4 w-4" /> Pause</Button>
                  </>
                )}
                {phase !== "calling" && phase !== "wrapup" && !manual && (
                  <Button variant="ghost" onClick={stopDialing}><Square className="h-4 w-4" /> Stop dialing</Button>
                )}
              </div>
            </>
          )}
        </Card>
      )}

      {error && <Alert>{error}</Alert>}

      {phase === "idle" && !single && (
        <Card className="py-16 text-center">
          <Phone className="mx-auto h-10 w-10 text-gray-300" />
          <p className="mt-3 font-medium text-gray-900">Pick EAST or WEST, then click Start dialing.</p>
          <p className="mt-1 text-sm text-gray-500">Leads load one at a time. Nobody else can get the lead you&apos;re on.</p>
        </Card>
      )}

      {(phase === "idle" || phase === "empty") && (
        <div className="max-w-sm">
          <KeypadPanel busy={busy} defaultOpen={phase === "idle"} onDial={(n) => void d.dialNumber(n)} />
        </div>
      )}

      {phase === "loading" && <Card className="py-16 text-center text-gray-500">Loading the next lead…</Card>}

      {phase === "empty" && (
        <Card className="py-16 text-center">
          <p className="font-medium text-gray-900">No leads ready on {list} right now.</p>
          <p className="mt-1 text-sm text-gray-500">
            Everyone left is waiting for a retry time or is outside calling hours. Checking again every minute.
          </p>
          <Button variant="secondary" className="mt-4" onClick={() => loadNext(list)}>Check now</Button>
        </Card>
      )}

      {phase === "paused" && (
        <Card className="py-16 text-center">
          <Coffee className="mx-auto h-10 w-10 text-amber-500" />
          <p className="mt-3 text-lg font-semibold text-gray-900">Paused: {PAUSE_LABELS[pauseReason]}</p>
          <p className="mt-1 font-mono text-2xl text-gray-700">{pausedAt ? mmss(now - pausedAt) : ""}</p>
          <Button className="mt-5" onClick={resume}><Play className="h-4 w-4" /> Resume dialing</Button>
        </Card>
      )}

      {manual && !lead && manualPhone && (phase === "lead" || phase === "calling" || phase === "wrapup") && (
        <div className="space-y-4">
          <Card>
            <p className="text-sm font-medium uppercase tracking-wide text-gray-500">New number, not in the CRM</p>
            <p className="mt-2 font-mono text-3xl font-semibold text-gray-900">{formatPhone(manualPhone)}</p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              {phase === "lead" && (
                <>
                  <Button onClick={call} disabled={busy || !callingReady} className="bg-green-600 px-6 py-3 text-base hover:bg-green-700">
                    <Phone className="h-5 w-5" /> Call
                  </Button>
                  <Button variant="ghost" onClick={() => void d.cancelManual()} disabled={busy}>Cancel</Button>
                </>
              )}
              {onCall && callControls}
            </div>
            {onCall && showKeypad && dtmfPad}
          </Card>
          {phase === "wrapup" && (
            <SaveNewNumber phone={manualPhone} busy={busy} hadCall={Boolean(callId)} onSave={d.saveManualLead} onSkip={(x) => void d.closeUnknown(x)} />
          )}
        </div>
      )}

      {lead && (phase === "lead" || phase === "calling" || phase === "wrapup") && (
        <div className="grid gap-4 xl:grid-cols-[1fr_24rem]">
          <div className="space-y-4">
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 space-y-1">
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Owner</p>
                  <OwnerName key={lead.id} lead={lead} onSaved={(name) => d.patchLead({ contact_name: name })} />
                  <h2 className="pt-2 text-xl font-semibold text-gray-700">{lead.business_name}</h2>
                  <p className="text-gray-500">{[lead.city, lead.state].filter(Boolean).join(", ")}</p>
                  <p className="pt-2 font-mono text-3xl font-semibold text-gray-900">{formatPhone(lead.phone_e164)}</p>
                  <p className="mt-1 text-sm text-gray-500">
                    {timezoneLabel(lead.timezone)} · their time {lead.timezone ? new Date().toLocaleTimeString("en-US", { timeZone: lead.timezone, hour: "numeric", minute: "2-digit" }) : "unknown"}
                    {" · "}
                    {lead.attempt_count === 0 ? "never called" : `called ${lead.attempt_count}×`}
                  </p>
                </div>
                <Badge tone={STATUS_TONES[lead.status]}>{STATUS_LABELS[lead.status]}</Badge>
              </div>
              {phase === "lead" && <div className="mt-4"><PhoneTools phone={lead.phone_e164} /></div>}

              {/* Call controls */}
              <div className="mt-6 flex flex-wrap items-center gap-3">
                {phase === "lead" && (
                  <>
                    <Button onClick={call} disabled={busy || !callingReady} className="bg-green-600 px-6 py-3 text-base hover:bg-green-700">
                      <Phone className="h-5 w-5" /> Call
                    </Button>
                    {manual ? (
                      <Button variant="ghost" onClick={() => void d.cancelManual()} disabled={busy}>Cancel</Button>
                    ) : (
                      <button className="text-sm text-gray-500 underline-offset-2 hover:underline" onClick={() => setPhase("wrapup")}>
                        Pick an outcome without calling
                      </button>
                    )}
                  </>
                )}
                {onCall && callControls}
              </div>
              {(phase === "lead" || onCall || phase === "wrapup") && (
                <div className="mt-4">
                  <Button variant="secondary" onClick={() => setPaying(true)} className="ring-green-300 text-green-800">
                    <CreditCard className="h-4 w-4" /> Take payment
                  </Button>
                </div>
              )}
              {onCall && showKeypad && dtmfPad}
            </Card>

            {phase === "wrapup" && (
              <WrapUp
                busy={busy}
                hadCall={Boolean(callId)}
                leadTimezone={lead.timezone}
                showPauseAfter={mode === "queue"}
                onSubmit={submitDisposition}
                onBack={callId || manual ? undefined : () => setPhase("lead")}
              />
            )}

            <LeadDetails lead={lead} />
          </div>

          <div className="space-y-4">
            {phase === "lead" && !manual && <KeypadPanel busy={busy} onDial={(n) => void d.dialNumber(n)} />}
            <NotesPanel notes={ctx.notes} onAdd={onAddNote} />
            <PastCalls calls={ctx.calls} />
          </div>
        </div>
      )}

      {paying && lead && <PaymentModal lead={lead} payments={payments} onClose={() => setPaying(false)} />}
    </div>
  );
}

function PaymentModal({ lead, payments, onClose }: { lead: LeadContext["lead"]; payments: PaymentSetup; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/30 p-4">
      <Card className="mx-auto my-6 max-w-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Take payment: {lead.business_name}</h2>
          <button onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <p className="mb-4 text-sm text-gray-500">Your call stays connected while this is open.</p>
        <PaymentFlow {...payments} lead={lead} onDone={onClose} />
      </Card>
    </div>
  );
}

function StatusPill({ phase, callState, pauseReason }: { phase: Phase; callState: string | null; pauseReason: PauseReason }) {
  if (phase === "calling") return <Badge tone="green">{callState === "open" ? "On a call" : "Dialing"}</Badge>;
  if (phase === "wrapup") return <Badge tone="amber">Pick an outcome</Badge>;
  if (phase === "paused") return <Badge tone="amber">Paused: {PAUSE_LABELS[pauseReason]}</Badge>;
  return <Badge tone="blue">Ready</Badge>;
}
