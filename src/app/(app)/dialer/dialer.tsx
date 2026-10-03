"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Call, Device } from "@twilio/voice-sdk";
import { Coffee, Grid3x3, Mic, MicOff, Pause, Phone, PhoneOff, Play, Square } from "lucide-react";
import { Alert, Badge, Button, Card, Select } from "@/components/ui";
import { formatPhone } from "@/lib/phone";
import { STATUS_LABELS, STATUS_TONES, timezoneLabel } from "@/lib/leads";
import {
  addLeadNote,
  claimNext,
  dispose,
  getVoiceToken,
  heartbeat,
  setPresence,
  startCall,
  type LeadContext,
} from "./actions";
import { LeadDetails, NotesPanel, PastCalls } from "./lead-panels";
import { WrapUp, type Disposition } from "./wrap-up";

type Phase = "idle" | "loading" | "empty" | "lead" | "calling" | "wrapup" | "paused";
type PauseReason = "lunch" | "break" | "meeting" | "training" | "other";
type ListName = "EAST" | "WEST";

const PAUSE_LABELS: Record<PauseReason, string> = {
  lunch: "Lunch",
  break: "Break",
  meeting: "Meeting",
  training: "Training",
  other: "Other",
};

function useClock(running: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  return now;
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function Dialer({
  callingReady,
  callingProblem,
  singleLead,
}: {
  callingReady: boolean;
  callingProblem?: string;
  /** Calling one of the rep's own leads (from My leads), not the queue. */
  singleLead?: LeadContext;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(singleLead ? "lead" : "idle");
  const [list, setList] = useState<ListName>("EAST");
  const [ctx, setCtx] = useState<LeadContext | null>(singleLead ?? null);
  const [error, setError] = useState<string | null>(null);
  const [callId, setCallId] = useState<string | null>(null);
  const [callState, setCallState] = useState<"connecting" | "ringing" | "open" | null>(null);
  const [answeredAt, setAnsweredAt] = useState<number | null>(null);
  const [muted, setMuted] = useState(false);
  const [showKeypad, setShowKeypad] = useState(false);
  const [pauseReason, setPauseReason] = useState<PauseReason>("break");
  const [pausedAt, setPausedAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const deviceRef = useRef<Device | null>(null);
  const callRef = useRef<Call | null>(null);
  const sessionActive = phase !== "idle" || Boolean(singleLead);

  const now = useClock(callState === "open" || phase === "paused" || phase === "empty");

  // Moves to the outcome screen once per call, however the call ended
  // (hung up, never connected, or a connection error).
  const endedRef = useRef(true);
  const endCall = useCallback(() => {
    if (endedRef.current) return;
    endedRef.current = true;
    callRef.current = null;
    setCallState(null);
    setShowKeypad(false);
    setPhase("wrapup");
    void setPresence({ status: "wrap_up" });
  }, []);

  // ---- Twilio device -------------------------------------------------------
  const ensureDevice = useCallback(async (): Promise<Device | null> => {
    if (deviceRef.current) return deviceRef.current;
    const res = await getVoiceToken();
    if (!res.token) {
      setError(res.error ?? "Calling isn't available.");
      return null;
    }
    const { Device } = await import("@twilio/voice-sdk");
    const device = new Device(res.token, { closeProtection: true, codecPreferences: ["opus", "pcmu"] as never });
    device.on("tokenWillExpire", async () => {
      const fresh = await getVoiceToken();
      if (fresh.token) device.updateToken(fresh.token);
    });
    device.on("error", (e: { message?: string }) => {
      setError(`Phone error: ${e.message ?? "unknown"}`);
      // A connection failure mid-dial ends the call rather than leaving the rep stuck.
      endCall();
    });
    deviceRef.current = device;
    return device;
  }, [endCall]);

  useEffect(() => {
    return () => {
      deviceRef.current?.destroy();
      deviceRef.current = null;
    };
  }, []);

  // ---- Keep the claim alive, and let go of it when leaving -----------------
  useEffect(() => {
    if (!sessionActive) return;
    const t = setInterval(() => void heartbeat(), 45_000);
    const leave = () => navigator.sendBeacon("/api/presence/leave");
    window.addEventListener("pagehide", leave);
    return () => {
      clearInterval(t);
      window.removeEventListener("pagehide", leave);
    };
  }, [sessionActive]);

  useEffect(() => {
    // Leaving the dialer page inside the app ends the dialing session.
    return () => {
      void setPresence({ status: "idle" });
    };
  }, []);

  // ---- Queue ---------------------------------------------------------------
  const loadNext = useCallback(
    async (which: ListName) => {
      setPhase("loading");
      setError(null);
      setCtx(null);
      setCallId(null);
      const res = await claimNext(which);
      if (res.error) {
        setError(res.error);
        setPhase("empty");
        return;
      }
      if (!res.context) {
        setPhase("empty");
        return;
      }
      setCtx(res.context);
      setPhase("lead");
      await setPresence({ status: "ready", list: which });
    },
    [],
  );

  // When the list is empty, check again every minute.
  useEffect(() => {
    if (phase !== "empty" || singleLead) return;
    const t = setTimeout(() => void loadNext(list), 60_000);
    return () => clearTimeout(t);
  }, [phase, list, loadNext, singleLead]);

  async function startDialing() {
    setBusy(true);
    setError(null);
    if (callingReady) await ensureDevice();
    const res = await setPresence({ status: "ready", list });
    setBusy(false);
    if (res.error) return setError(res.error);
    await loadNext(list);
  }

  async function stopDialing() {
    await setPresence({ status: "idle" });
    setCtx(null);
    setPhase("idle");
  }

  async function pause() {
    const res = await setPresence({ status: "paused", reason: pauseReason });
    if (res.error) return setError(res.error);
    setCtx(null);
    setPausedAt(Date.now());
    setPhase("paused");
  }

  async function resume() {
    setPausedAt(null);
    await setPresence({ status: "ready", list });
    await loadNext(list);
  }

  // ---- Calling -------------------------------------------------------------
  async function call() {
    if (!ctx) return;
    setError(null);
    setBusy(true);
    const device = await ensureDevice();
    if (!device) return setBusy(false);
    const started = await startCall(ctx.lead.id);
    if (!started.callId) {
      setBusy(false);
      setError(started.error ?? "Couldn't start the call.");
      if (started.error?.includes("isn't yours")) void loadNext(list);
      return;
    }
    setCallId(started.callId);
    endedRef.current = false;
    setCallState("connecting");
    setAnsweredAt(null);
    setMuted(false);
    setPhase("calling");
    setBusy(false);

    try {
      const c = await device.connect({ params: { callId: started.callId } });
      callRef.current = c;
      c.on("ringing", () => setCallState("ringing"));
      c.on("accept", () => {
        setCallState("open");
        setAnsweredAt(Date.now());
      });
      c.on("disconnect", endCall);
      c.on("cancel", endCall);
      c.on("reject", endCall);
      c.on("error", (e: { message?: string }) => {
        setError(`Call error: ${e.message ?? "unknown"}`);
        endCall();
      });
    } catch (e) {
      setError(`Couldn't connect the call: ${(e as Error).message}. Check that the browser can use your microphone.`);
      endCall();
    }
  }

  function hangUp() {
    if (callRef.current) callRef.current.disconnect();
    // If the call never connected there's nothing to disconnect; end it anyway.
    endCall();
  }

  function toggleMute() {
    const c = callRef.current;
    if (!c) return;
    c.mute(!c.isMuted());
    setMuted(c.isMuted());
  }

  // ---- Disposition ---------------------------------------------------------
  async function submitDisposition(d: Disposition) {
    if (!ctx) return;
    setBusy(true);
    const res = await dispose({
      leadId: ctx.lead.id,
      callId,
      disposition: d.disposition,
      note: d.note,
      appointmentStart: d.appointmentStart ?? null,
      appointmentMinutes: d.appointmentMinutes ?? null,
    });
    setBusy(false);
    if (res.error) return setError(res.error);

    setCallId(null);
    if (singleLead) {
      router.push(`/leads/${ctx.lead.id}`);
      router.refresh();
      return;
    }
    if (d.pauseAfter) {
      setPauseReason(d.pauseAfter);
      await setPresence({ status: "paused", reason: d.pauseAfter });
      setCtx(null);
      setPausedAt(Date.now());
      setPhase("paused");
      return;
    }
    await loadNext(list);
  }

  async function onAddNote(body: string) {
    if (!ctx) return { error: "No lead loaded." };
    const res = await addLeadNote(ctx.lead.id, body);
    if (res.note) setCtx((c) => (c ? { ...c, notes: [res.note!, ...c.notes] } : c));
    return res;
  }

  // ---- Render --------------------------------------------------------------
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
      {!singleLead && (
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
              <div className="ml-auto flex flex-wrap items-center gap-2">
                {(phase === "lead" || phase === "empty") && (
                  <>
                    <Select value={pauseReason} onChange={(e) => setPauseReason(e.target.value as PauseReason)} aria-label="Pause reason" className="w-32">
                      {Object.entries(PAUSE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </Select>
                    <Button variant="secondary" onClick={pause}><Pause className="h-4 w-4" /> Pause</Button>
                  </>
                )}
                {phase !== "calling" && phase !== "wrapup" && (
                  <Button variant="ghost" onClick={stopDialing}><Square className="h-4 w-4" /> Stop dialing</Button>
                )}
              </div>
            </>
          )}
        </Card>
      )}

      {error && <Alert>{error}</Alert>}

      {phase === "idle" && !singleLead && (
        <Card className="py-16 text-center">
          <Phone className="mx-auto h-10 w-10 text-gray-300" />
          <p className="mt-3 font-medium text-gray-900">Pick EAST or WEST, then click Start dialing.</p>
          <p className="mt-1 text-sm text-gray-500">Leads load one at a time. Nobody else can get the lead you&apos;re on.</p>
        </Card>
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

      {lead && (phase === "lead" || phase === "calling" || phase === "wrapup") && (
        <div className="grid gap-4 xl:grid-cols-[1fr_24rem]">
          <div className="space-y-4">
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="text-2xl font-semibold tracking-tight text-gray-900">{lead.business_name}</h2>
                  <p className="mt-1 text-gray-600">
                    {[lead.contact_name, [lead.city, lead.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}
                  </p>
                  <p className="mt-3 font-mono text-3xl font-semibold text-gray-900">{formatPhone(lead.phone_e164)}</p>
                  <p className="mt-1 text-sm text-gray-500">
                    {timezoneLabel(lead.timezone)} · their time {lead.timezone ? new Date().toLocaleTimeString("en-US", { timeZone: lead.timezone, hour: "numeric", minute: "2-digit" }) : "unknown"}
                    {" · "}
                    {lead.attempt_count === 0 ? "never called" : `called ${lead.attempt_count}×`}
                  </p>
                </div>
                <Badge tone={STATUS_TONES[lead.status]}>{STATUS_LABELS[lead.status]}</Badge>
              </div>

              {/* Call controls */}
              <div className="mt-6 flex flex-wrap items-center gap-3">
                {phase === "lead" && (
                  <>
                    <Button onClick={call} disabled={busy || !callingReady} className="bg-green-600 px-6 py-3 text-base hover:bg-green-700">
                      <Phone className="h-5 w-5" /> Call
                    </Button>
                    <button className="text-sm text-gray-500 underline-offset-2 hover:underline" onClick={() => setPhase("wrapup")}>
                      Pick an outcome without calling
                    </button>
                  </>
                )}
                {onCall && (
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
                )}
              </div>
              {onCall && showKeypad && (
                <div className="mt-4 grid w-48 grid-cols-3 gap-2">
                  {["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"].map((k) => (
                    <button
                      key={k}
                      onClick={() => callRef.current?.sendDigits(k)}
                      className="rounded-lg bg-gray-100 py-2 text-lg font-semibold text-gray-800 hover:bg-gray-200"
                    >
                      {k}
                    </button>
                  ))}
                </div>
              )}
            </Card>

            {phase === "wrapup" && (
              <WrapUp
                busy={busy}
                hadCall={Boolean(callId)}
                leadTimezone={lead.timezone}
                showPauseAfter={!singleLead}
                onSubmit={submitDisposition}
                onBack={callId ? undefined : () => setPhase("lead")}
              />
            )}

            <LeadDetails lead={lead} />
          </div>

          <div className="space-y-4">
            <NotesPanel notes={ctx.notes} onAdd={onAddNote} />
            <PastCalls calls={ctx.calls} />
          </div>
        </div>
      )}
    </div>
  );
}

function StatusPill({ phase, callState, pauseReason }: { phase: Phase; callState: string | null; pauseReason: PauseReason }) {
  if (phase === "calling") return <Badge tone="green">{callState === "open" ? "On a call" : "Dialing"}</Badge>;
  if (phase === "wrapup") return <Badge tone="amber">Pick an outcome</Badge>;
  if (phase === "paused") return <Badge tone="amber">Paused: {PAUSE_LABELS[pauseReason]}</Badge>;
  return <Badge tone="blue">Ready</Badge>;
}
