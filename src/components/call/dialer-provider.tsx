"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Call, Device } from "@twilio/voice-sdk";
import {
  addLeadNote,
  claimNext,
  closeManualCall,
  dispose,
  getCallProgress,
  getVoiceToken,
  loadLeadContext,
  removeFromMissed,
  lookupNumber,
  releaseLead,
  saveCallAsLead,
  sendCallDigits,
  setPresence,
  startCall,
  startManualCall,
  type DialerLead,
  type LeadContext,
} from "@/app/(app)/dialer/actions";
import type { Disposition } from "@/app/(app)/dialer/wrap-up";
import { switchMonitor } from "@/components/live/actions";
import { startRingback } from "./ringback";
import type { MonitorMode } from "@/lib/twilio";

/** Listening in on another rep's call. */
export type MonitorTarget = { withWho: string; phone: string; leadHref: string | null };
export type Monitor = MonitorTarget & { callId: string; repName: string; mode: MonitorMode; callSid: string | null; connected: boolean };

export type Phase = "idle" | "loading" | "empty" | "lead" | "calling" | "wrapup" | "paused";
export type PauseReason = "lunch" | "break" | "meeting" | "training" | "other";
/** EAST / WEST = shared pool; MINE = the rep's private list. */
export type ListName = "EAST" | "WEST" | "MINE" | "MISSED";
export const LIST_LABELS: Record<ListName, string> = { EAST: "EAST", WEST: "WEST", MINE: "MY LIST", MISSED: "DEMO MISSED" };
export type CallState = "connecting" | "ringing" | "open" | null;

export const PAUSE_LABELS: Record<PauseReason, string> = {
  lunch: "Lunch",
  break: "Break",
  meeting: "Meeting",
  training: "Training",
  other: "Other",
};

export type Mode = "queue" | "single" | "manual";

type DialerApi = {
  phase: Phase;
  /** The company number the current call went out on (caller ID the prospect sees). */
  fromNumber: string | null;
  /** queue = EAST/WEST dialing, single = one of the rep's own leads, manual = typed on the keypad */
  mode: Mode;
  /** Keypad call: the number dialed (ctx is null when it isn't in the CRM yet). */
  manualPhone: string | null;
  list: ListName;
  ctx: LeadContext | null;
  error: string | null;
  callId: string | null;
  callState: CallState;
  answeredAt: number | null;
  muted: boolean;
  pauseReason: PauseReason;
  pausedAt: number | null;
  busy: boolean;
  paying: boolean;
  setList: (l: ListName) => void;
  setPauseReason: (r: PauseReason) => void;
  setError: (e: string | null) => void;
  setPaying: (v: boolean) => void;
  setPhase: (p: Phase) => void;
  startDialing: (prewarm: boolean) => Promise<void>;
  stopDialing: () => Promise<void>;
  loadNext: (l: ListName) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  /** returnTo: where to go after the outcome (default: the lead's page). */
  startSingle: (c: LeadContext, returnTo?: string) => boolean;
  /** Take the current lead out of the Demo Missed folder (and move on when dialing that folder). */
  removeCurrentFromMissed: () => Promise<void>;
  call: () => Promise<void>;
  hangUp: () => void;
  toggleMute: () => void;
  sendDigits: (d: string) => void;
  submitDisposition: (d: Disposition) => Promise<void>;
  addNote: (body: string) => Promise<{ error?: string }>;
  patchLead: (patch: Partial<DialerLead>) => void;
  reloadLead: () => Promise<void>;
  dialNumber: (raw: string) => Promise<void>;
  cancelManual: () => Promise<void>;
  saveManualLead: (input: { businessName: string; ownerName: string; email?: string }) => Promise<{ error?: string }>;
  closeUnknown: (d: "no_answer" | "bad_number") => Promise<void>;
  monitor: Monitor | null;
  listenIn: (callId: string, repName: string, mode: MonitorMode, target: MonitorTarget) => Promise<void>;
  switchMonitorMode: (mode: MonitorMode) => Promise<void>;
  leaveMonitor: () => void;
};

const DialerContext = createContext<DialerApi | null>(null);

export function useDialer(): DialerApi {
  const api = useContext(DialerContext);
  if (!api) throw new Error("useDialer must be used inside DialerProvider");
  return api;
}

/**
 * The phone and the dialing session live here, in the app's layout, so they
 * survive moving between pages (Calendar, Payments, My leads…). A call only
 * ends when someone hangs up, or the browser tab itself is closed.
 */
export function DialerProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [mode, setMode] = useState<Mode>("queue");
  const [manualPhone, setManualPhone] = useState<string | null>(null);
  // Where to go after a keypad call: back to the EAST/WEST queue, or idle.
  const returnToQueue = useRef(false);
  const [list, setList] = useState<ListName>("EAST");
  const [ctx, setCtx] = useState<LeadContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [callId, setCallId] = useState<string | null>(null);
  const [callState, setCallState] = useState<CallState>(null);
  const [answeredAt, setAnsweredAt] = useState<number | null>(null);
  const [muted, setMuted] = useState(false);
  const [pauseReason, setPauseReason] = useState<PauseReason>("break");
  const [pausedAt, setPausedAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [paying, setPaying] = useState(false);
  // Conference calls connect the rep right away; "answered" comes from the server.
  const [conference, setConference] = useState(false);
  const [fromNumber, setFromNumber] = useState<string | null>(null);
  const [monitor, setMonitor] = useState<Monitor | null>(null);
  const monitorCallRef = useRef<Call | null>(null);

  const deviceRef = useRef<Device | null>(null);
  const callRef = useRef<Call | null>(null);

  // Moves to the outcome screen once per call, however it ended.
  const endedRef = useRef(true);
  const endCall = useCallback(() => {
    if (endedRef.current) return;
    endedRef.current = true;
    callRef.current = null;
    setCallState(null);
    setPhase("wrapup");
    void setPresence({ status: "wrap_up" });
  }, []);

  const ensureDevice = useCallback(async (): Promise<Device | null> => {
    if (deviceRef.current) return deviceRef.current;
    const res = await getVoiceToken();
    if (!res.token) {
      setError(res.error ?? "Calling isn't available.");
      return null;
    }
    const { Device } = await import("@twilio/voice-sdk");
    // closeProtection: the browser asks "Leave site?" if the tab is closed mid-call.
    const device = new Device(res.token, { closeProtection: true, codecPreferences: ["opus", "pcmu"] as never });
    device.on("tokenWillExpire", async () => {
      const fresh = await getVoiceToken();
      if (fresh.token) device.updateToken(fresh.token);
    });
    device.on("error", (e: { message?: string }) => {
      setError(`Phone error: ${e.message ?? "unknown"}`);
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

  // Closing the tab gives the lead back right away.
  const sessionActive = phase !== "idle";
  useEffect(() => {
    if (!sessionActive) return;
    const leave = () => navigator.sendBeacon("/api/presence/leave");
    window.addEventListener("pagehide", leave);
    return () => window.removeEventListener("pagehide", leave);
  }, [sessionActive]);

  const loadNext = useCallback(async (which: ListName) => {
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
  }, []);

  // When the list is empty, check again every minute.
  useEffect(() => {
    if (phase !== "empty" || mode !== "queue") return;
    const t = setTimeout(() => void loadNext(list), 60_000);
    return () => clearTimeout(t);
  }, [phase, mode, list, loadNext]);

  const startDialing = useCallback(async (prewarm: boolean) => {
    if (monitorCallRef.current) {
      setError("Leave the call you're listening to before dialing.");
      return;
    }
    setBusy(true);
    setError(null);
    setMode("queue");
    if (prewarm) await ensureDevice();
    const res = await setPresence({ status: "ready", list });
    setBusy(false);
    if (res.error) return setError(res.error);
    await loadNext(list);
  }, [ensureDevice, list, loadNext]);

  const stopDialing = useCallback(async () => {
    await setPresence({ status: "idle" });
    setCtx(null);
    setMode("queue");
    setPhase("idle");
  }, []);

  const pause = useCallback(async () => {
    const res = await setPresence({ status: "paused", reason: pauseReason });
    if (res.error) return setError(res.error);
    setCtx(null);
    setPausedAt(Date.now());
    setPhase("paused");
  }, [pauseReason]);

  const resume = useCallback(async () => {
    setPausedAt(null);
    await setPresence({ status: "ready", list });
    await loadNext(list);
  }, [list, loadNext]);

  /** Switch to calling one of the rep's own leads. Not allowed mid-call. */
  const singleReturn = useRef<string | null>(null);
  const startSingle = useCallback((c: LeadContext, returnTo?: string) => {
    if (phase === "calling" || phase === "wrapup") {
      setError("Finish your current call (pick an outcome) before calling another lead.");
      return false;
    }
    if (phase !== "idle") void setPresence({ status: "idle" }); // gives back any queue lead
    setMode("single");
    singleReturn.current = returnTo ?? null;
    setCtx(c);
    setCallId(null);
    setError(null);
    setPhase("lead");
    return true;
  }, [phase]);

  type Target = { manual: false; leadId: string } | { manual: true; phone: string; leadId: string | null };

  const placeCall = useCallback(async (target: Target) => {
    if (monitorCallRef.current) {
      setError("Leave the call you're listening to before calling.");
      return;
    }
    setError(null);
    setBusy(true);
    const device = await ensureDevice();
    if (!device) return setBusy(false);
    const started = target.manual
      ? await startManualCall(target.phone, target.leadId)
      : await startCall(target.leadId);
    if (!started.callId) {
      setBusy(false);
      setError(started.error ?? "Couldn't start the call.");
      if (started.error?.includes("isn't yours") && mode === "queue") void loadNext(list);
      return;
    }
    setCallId(started.callId);
    setFromNumber(null);
    const conf = Boolean(started.conference);
    setConference(conf);
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
        if (conf) return setCallState("ringing"); // the rep is in the room; the prospect is still ringing
        setCallState("open");
        setAnsweredAt(Date.now());
      });
      // Conference call: the server tells us the moment the prospect picks up.
      c.on("messageReceived", (m: { content?: unknown }) => {
        const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? {});
        if (conf && content.includes("answered") && !endedRef.current) {
          setCallState("open");
          setAnsweredAt((t) => t ?? Date.now());
        }
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
  }, [ensureDevice, endCall, mode, list, loadNext]);

  const call = useCallback(async () => {
    if (mode === "manual" && manualPhone) return placeCall({ manual: true, phone: manualPhone, leadId: ctx?.lead.id ?? null });
    if (ctx) return placeCall({ manual: false, leadId: ctx.lead.id });
  }, [mode, manualPhone, ctx, placeCall]);

  const hangUp = useCallback(() => {
    if (callRef.current) callRef.current.disconnect();
    endCall(); // also covers a call that never connected
  }, [endCall]);

  const toggleMute = useCallback(() => {
    const c = callRef.current;
    if (!c) return;
    c.mute(!c.isMuted());
    setMuted(c.isMuted());
  }, []);

  const sendDigits = useCallback((d: string) => {
    if (!conference) return callRef.current?.sendDigits(d);
    if (callId) void sendCallDigits(callId, d).then((r) => r.error && setError(r.error));
  }, [conference, callId]);

  // Every 1.5s until known: which company number the call went out on (shown to the rep),
  // and for conference calls whether the prospect picked up.
  const needProgress = phase === "calling" && Boolean(callId) && (!fromNumber || (conference && callState !== "open"));
  useEffect(() => {
    if (!needProgress || !callId) return;
    const t = setInterval(async () => {
      const p = await getCallProgress(callId);
      if (p.fromNumber) setFromNumber(p.fromNumber);
      if (conference && p.answered && !endedRef.current) {
        setCallState("open");
        setAnsweredAt((t) => t ?? Date.now());
      }
    }, 1000);
    return () => clearInterval(t);
  }, [needProgress, conference, callId]);

  // Ringing tone while a conference call rings (stops when they pick up or the call ends).
  const ringing = conference && phase === "calling" && callState === "ringing";
  useEffect(() => {
    if (!ringing) return;
    return startRingback();
  }, [ringing]);

  // ---- Listening in on another rep's call ------------------------------------
  const listenIn = useCallback(async (targetCallId: string, repName: string, mode: MonitorMode, target: MonitorTarget) => {
    if (monitorCallRef.current) monitorCallRef.current.disconnect();
    if (phase !== "idle" && phase !== "paused") {
      setError("Pause or stop dialing before listening in on a call.");
      return;
    }
    setError(null);
    const device = await ensureDevice();
    if (!device) return;
    setMonitor({ ...target, callId: targetCallId, repName, mode, callSid: null, connected: false });
    try {
      const c = await device.connect({ params: { monitor: targetCallId, mode } });
      monitorCallRef.current = c;
      c.mute(mode === "listen"); // can't be heard anyway; keeps the mic quiet
      c.on("accept", () => {
        setMonitor((m) => (m ? { ...m, callSid: c.parameters.CallSid ?? null, connected: true } : m));
      });
      const done = () => {
        if (monitorCallRef.current === c) monitorCallRef.current = null;
        setMonitor((m) => (m?.callId === targetCallId ? null : m));
      };
      c.on("disconnect", done);
      c.on("cancel", done);
      c.on("reject", done);
      c.on("error", (e: { message?: string }) => {
        setError(`Listening error: ${e.message ?? "unknown"}`);
        done();
      });
    } catch (e) {
      setError(`Couldn't listen in: ${(e as Error).message}. Check that the browser can use your microphone.`);
      setMonitor(null);
    }
  }, [phase, ensureDevice]);

  const switchMonitorMode = useCallback(async (mode: MonitorMode) => {
    if (!monitor?.callSid) return;
    const res = await switchMonitor(monitor.callId, monitor.callSid, mode);
    if (res.error) return setError(res.error);
    monitorCallRef.current?.mute(mode === "listen");
    setMonitor((m) => (m ? { ...m, mode } : m));
  }, [monitor]);

  const leaveMonitor = useCallback(() => {
    monitorCallRef.current?.disconnect();
    monitorCallRef.current = null;
    setMonitor(null);
  }, []);

  // ---- Keypad (manual) calls ------------------------------------------------

  /** After a keypad call: back to the queue if the rep was dialing, else idle. */
  const finishManual = useCallback(async () => {
    setManualPhone(null);
    setCtx(null);
    setCallId(null);
    setMode("queue");
    if (returnToQueue.current) {
      returnToQueue.current = false;
      await loadNext(list);
    } else {
      setPhase("idle");
      void setPresence({ status: "idle" });
    }
  }, [list, loadNext]);

  const dialNumber = useCallback(async (raw: string) => {
    if (monitorCallRef.current) {
      setError("Leave the call you're listening to before calling.");
      return;
    }
    if (phase === "calling" || phase === "wrapup") {
      setError("Finish your current call (pick an outcome) before dialing another number.");
      return;
    }
    if (phase === "paused") {
      setError("Resume dialing (or stop dialing) before using the keypad.");
      return;
    }
    if (phase === "loading") return;
    setError(null);
    setBusy(true);
    const res = await lookupNumber(raw);
    if (res.status === "blocked") {
      setBusy(false);
      setError(res.error);
      return;
    }
    // Give back the lead the rep was looking at (unless it's the same one).
    const held = ctx?.lead;
    const nextId = res.status === "lead" ? res.context.lead.id : null;
    if (held && held.id !== nextId && !held.owner_id) await releaseLead(held.id);
    if (mode !== "manual") returnToQueue.current = mode === "queue" && phase !== "idle";
    setMode("manual");
    setManualPhone(res.phone);
    setCtx(res.status === "lead" ? res.context : null);
    setCallId(null);
    setPhase("lead");
    setBusy(false);
    // Dial right away: the rep already pressed Call on the keypad.
    await placeCall({ manual: true, phone: res.phone, leadId: nextId });
  }, [phase, ctx, mode, placeCall]);

  const cancelManual = useCallback(async () => {
    if (ctx && !ctx.lead.owner_id) await releaseLead(ctx.lead.id);
    await finishManual();
  }, [ctx, finishManual]);

  const saveManualLead = useCallback(async (input: { businessName: string; ownerName: string; email?: string }) => {
    if (!manualPhone) return { error: "No number." };
    setBusy(true);
    const res = await saveCallAsLead({ callId, phone: manualPhone, ...input });
    setBusy(false);
    if (res.context) setCtx(res.context);
    return { error: res.error };
  }, [callId, manualPhone]);

  const closeUnknown = useCallback(async (d: "no_answer" | "bad_number") => {
    if (callId) {
      setBusy(true);
      const res = await closeManualCall(callId, d);
      setBusy(false);
      if (res.error) return setError(res.error);
    }
    await finishManual();
  }, [callId, finishManual]);

  const submitDisposition = useCallback(async (d: Disposition) => {
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
    if (mode === "manual") return finishManual();
    if (mode === "single") {
      const id = ctx.lead.id;
      setCtx(null);
      setMode("queue");
      setPhase("idle");
      void setPresence({ status: "idle" });
      const back = singleReturn.current;
      singleReturn.current = null;
      if (back === "missed") setList("MISSED");
      router.push(back === "missed" ? "/dialer" : `/leads/${id}`);
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
  }, [ctx, callId, mode, list, loadNext, router, finishManual]);

  const addNote = useCallback(async (body: string) => {
    if (!ctx) return { error: "No lead loaded." };
    const res = await addLeadNote(ctx.lead.id, body);
    if (res.note) setCtx((c) => (c ? { ...c, notes: [res.note!, ...c.notes] } : c));
    return res;
  }, [ctx]);

  const patchLead = useCallback((patch: Partial<DialerLead>) => {
    setCtx((c) => (c ? { ...c, lead: { ...c.lead, ...patch } } : c));
  }, []);

  const removeCurrentFromMissed = useCallback(async () => {
    if (!ctx) return;
    const res = await removeFromMissed(ctx.lead.id);
    if (res.error) return setError(res.error);
    if (mode === "queue" && list === "MISSED" && phase === "lead") return loadNext(list);
    setCtx((c) => (c ? { ...c, lead: { ...c.lead, missed_since: null } } : c));
  }, [ctx, mode, list, phase, loadNext]);

  /** Re-read the lead, notes, and calls (after an edit). */
  const reloadLead = useCallback(async () => {
    const id = ctx?.lead.id;
    if (!id) return;
    const fresh = await loadLeadContext(id);
    if (fresh) setCtx((c) => (c?.lead.id === id ? fresh : c));
  }, [ctx?.lead.id]);

  const api: DialerApi = {
    phase, fromNumber, mode, manualPhone, list, ctx, error, callId, callState, answeredAt, muted, pauseReason, pausedAt, busy, paying,
    setList, setPauseReason, setError, setPaying, setPhase,
    startDialing, stopDialing, loadNext, pause, resume, startSingle, call, hangUp, toggleMute, sendDigits,
    submitDisposition, addNote, patchLead, reloadLead, removeCurrentFromMissed, dialNumber, cancelManual, saveManualLead, closeUnknown,
    monitor, listenIn, switchMonitorMode, leaveMonitor,
  };
  return <DialerContext.Provider value={api}>{children}</DialerContext.Provider>;
}

export function useClock(running: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  return now;
}

export const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
