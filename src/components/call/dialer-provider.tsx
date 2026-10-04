"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Call, Device } from "@twilio/voice-sdk";
import {
  addLeadNote,
  claimNext,
  dispose,
  getVoiceToken,
  setPresence,
  startCall,
  type LeadContext,
} from "@/app/(app)/dialer/actions";
import type { Disposition } from "@/app/(app)/dialer/wrap-up";

export type Phase = "idle" | "loading" | "empty" | "lead" | "calling" | "wrapup" | "paused";
export type PauseReason = "lunch" | "break" | "meeting" | "training" | "other";
export type ListName = "EAST" | "WEST";
export type CallState = "connecting" | "ringing" | "open" | null;

export const PAUSE_LABELS: Record<PauseReason, string> = {
  lunch: "Lunch",
  break: "Break",
  meeting: "Meeting",
  training: "Training",
  other: "Other",
};

type DialerApi = {
  phase: Phase;
  mode: "queue" | "single";
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
  startSingle: (c: LeadContext) => boolean;
  call: () => Promise<void>;
  hangUp: () => void;
  toggleMute: () => void;
  sendDigits: (d: string) => void;
  submitDisposition: (d: Disposition) => Promise<void>;
  addNote: (body: string) => Promise<{ error?: string }>;
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
  const [mode, setMode] = useState<"queue" | "single">("queue");
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
  const startSingle = useCallback((c: LeadContext) => {
    if (phase === "calling" || phase === "wrapup") {
      setError("Finish your current call (pick an outcome) before calling another lead.");
      return false;
    }
    if (phase !== "idle") void setPresence({ status: "idle" }); // gives back any queue lead
    setMode("single");
    setCtx(c);
    setCallId(null);
    setError(null);
    setPhase("lead");
    return true;
  }, [phase]);

  const call = useCallback(async () => {
    if (!ctx) return;
    setError(null);
    setBusy(true);
    const device = await ensureDevice();
    if (!device) return setBusy(false);
    const started = await startCall(ctx.lead.id);
    if (!started.callId) {
      setBusy(false);
      setError(started.error ?? "Couldn't start the call.");
      if (started.error?.includes("isn't yours") && mode === "queue") void loadNext(list);
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
  }, [ctx, ensureDevice, endCall, mode, list, loadNext]);

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

  const sendDigits = useCallback((d: string) => callRef.current?.sendDigits(d), []);

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
    if (mode === "single") {
      const id = ctx.lead.id;
      setCtx(null);
      setMode("queue");
      setPhase("idle");
      void setPresence({ status: "idle" });
      router.push(`/leads/${id}`);
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
  }, [ctx, callId, mode, list, loadNext, router]);

  const addNote = useCallback(async (body: string) => {
    if (!ctx) return { error: "No lead loaded." };
    const res = await addLeadNote(ctx.lead.id, body);
    if (res.note) setCtx((c) => (c ? { ...c, notes: [res.note!, ...c.notes] } : c));
    return res;
  }, [ctx]);

  const api: DialerApi = {
    phase, mode, list, ctx, error, callId, callState, answeredAt, muted, pauseReason, pausedAt, busy, paying,
    setList, setPauseReason, setError, setPaying, setPhase,
    startDialing, stopDialing, loadNext, pause, resume, startSingle, call, hangUp, toggleMute, sendDigits,
    submitDisposition, addNote,
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
