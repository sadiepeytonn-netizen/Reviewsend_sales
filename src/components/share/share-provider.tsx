"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { browserClient } from "@/lib/supabase/browser";
import { SIGNAL, channelName, quickStart, type RepNotice, type Signal, type ViewerDevice, type ViewerStats } from "@/lib/share/protocol";
import { useDialer } from "@/components/call/dialer-provider";
import { checkWatchPass, endShare, shareHeartbeat, startShare } from "./actions";

/** One person watching (watchers from Live are kept separately and never listed). */
export type Viewer = {
  id: string;
  device: ViewerDevice;
  place: string | null;
  joinedAt: number;
  connected: boolean;
  watchedSeconds: number;
  stats: ViewerStats | null;
};

type Peer = Viewer & {
  pc: RTCPeerConnection;
  dc: RTCDataChannel;
  pending: RTCIceCandidateInit[];
  silent: boolean; // watching from Live
};

type ShareApi = {
  status: "idle" | "starting" | "live";
  error: string | null;
  link: string | null;
  preview: MediaStream | null;
  viewers: Viewer[];
  watchers: number;
  locked: boolean;
  paused: boolean;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  switchScreen: () => Promise<void>;
  togglePause: () => void;
  toggleLock: () => void;
  remove: (id: string) => void;
  clearError: () => void;
};

const ShareContext = createContext<ShareApi | null>(null);

export function useShare(): ShareApi {
  const api = useContext(ShareContext);
  if (!api) throw new Error("useShare must be used inside ShareProvider");
  return api;
}

const QUALITY = { maxBitrate: 4_000_000, maxFramerate: 30 };

/** Ask Chrome for the whole screen (the rep picks their presenting monitor). Smooth motion first. */
async function pickScreen(): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { displaySurface: "monitor", frameRate: { ideal: 30, max: 30 }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    audio: false,
    selfBrowserSurface: "exclude",
    surfaceSwitching: "include",
    monitorTypeSurfaces: "include",
  } as DisplayMediaStreamOptions);
  const track = stream.getVideoTracks()[0];
  if (track) track.contentHint = "motion";
  return stream;
}

/**
 * The rep's screen share. Lives in the app layout (like the phone) so it keeps going while the
 * rep moves around the CRM. One browser-to-browser video connection per viewer.
 */
export function ShareProvider({ children }: { children: React.ReactNode }) {
  const d = useDialer();
  const [status, setStatus] = useState<ShareApi["status"]>("idle");
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [preview, setPreview] = useState<MediaStream | null>(null);
  const [viewers, setViewers] = useState<Viewer[]>([]);
  const [watchers, setWatchers] = useState(0);
  const [locked, setLocked] = useState(false);
  const [paused, setPaused] = useState(false);

  const stream = useRef<MediaStream | null>(null);
  const channel = useRef<RealtimeChannel | null>(null);
  const peers = useRef(new Map<string, Peer>());
  const blocked = useRef(new Set<string>());
  const shareId = useRef<string | null>(null);
  const ice = useRef<RTCIceServer[]>([]);
  const lockedRef = useRef(false);
  const pausedRef = useRef(false);
  const tally = useRef({ peak: 0, total: 0, watchedSeconds: 0, seen: new Set<string>() });
  const timers = useRef<ReturnType<typeof setInterval>[]>([]);
  const stopRef = useRef<() => Promise<void>>(async () => {});

  const send = (msg: Signal) => void channel.current?.send({ type: "broadcast", event: SIGNAL, payload: msg });

  const publish = useCallback(() => {
    const list = [...peers.current.values()];
    setViewers(
      list.filter((p) => !p.silent).map(({ id, device, place, joinedAt, connected, watchedSeconds, stats }) => ({ id, device, place, joinedAt, connected, watchedSeconds, stats })),
    );
    setWatchers(list.filter((p) => p.silent && p.connected).length);
  }, []);

  const drop = useCallback((id: string) => {
    const p = peers.current.get(id);
    if (!p) return;
    p.pc.close();
    peers.current.delete(id);
    publish();
  }, [publish]);

  const connect = useCallback(async (id: string, device: ViewerDevice, place: string | null, silent: boolean) => {
    const s = stream.current;
    if (!s) return;
    peers.current.get(id)?.pc.close();
    const pc = new RTCPeerConnection({ iceServers: ice.current });
    const dc = pc.createDataChannel("stats");
    const peer: Peer = { id, device, place, joinedAt: Date.now(), connected: false, watchedSeconds: 0, stats: null, pc, dc, pending: [], silent };
    peers.current.set(id, peer);
    for (const track of s.getTracks()) pc.addTrack(track, s);
    dc.onopen = () => dc.send(JSON.stringify({ paused: pausedRef.current } satisfies RepNotice));
    dc.onmessage = (m) => {
      try {
        peer.stats = JSON.parse(String(m.data)) as ViewerStats;
      } catch {}
    };
    pc.onicecandidate = (e) => e.candidate && send({ t: "ice", to: id, candidate: e.candidate.toJSON() });
    pc.onconnectionstatechange = () => {
      peer.connected = pc.connectionState === "connected";
      if (peer.connected && !silent) {
        tally.current.seen.add(id);
        tally.current.total = tally.current.seen.size;
      }
      if (pc.connectionState === "failed" || pc.connectionState === "closed") drop(id);
      else publish();
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    // Smooth motion over sharpness when their connection is slow.
    for (const sender of pc.getSenders()) {
      const params = sender.getParameters();
      params.degradationPreference = "maintain-framerate";
      params.encodings = (params.encodings?.length ? params.encodings : [{}]).map((e) => ({ ...e, ...QUALITY }));
      await sender.setParameters(params).catch(() => {});
    }
    send({ t: "offer", to: id, sdp: offer.sdp ?? "" });
    publish();
  }, [drop, publish]);

  const onSignal = useCallback(async (msg: Signal) => {
    if (msg.t === "hello") {
      const existing = peers.current.get(msg.from);
      if (existing?.connected) return; // a duplicate hello
      if (blocked.current.has(msg.from)) return send({ t: "removed", to: msg.from });
      const silent = msg.pass ? await checkWatchPass(msg.pass) : false;
      if (!silent && lockedRef.current && !existing) return send({ t: "locked", to: msg.from });
      if (existing && !existing.connected && Date.now() - existing.joinedAt < 8000) return; // still connecting
      await connect(msg.from, msg.device, msg.place, silent);
    } else if (msg.t === "answer") {
      const p = peers.current.get(msg.from);
      if (!p || p.pc.signalingState !== "have-local-offer") return;
      await p.pc.setRemoteDescription({ type: "answer", sdp: quickStart(msg.sdp) }).catch(() => {});
      for (const c of p.pending) await p.pc.addIceCandidate(c).catch(() => {});
      p.pending = [];
    } else if (msg.t === "ice" && msg.from) {
      const p = peers.current.get(msg.from);
      if (!p) return;
      if (p.pc.remoteDescription) await p.pc.addIceCandidate(msg.candidate).catch(() => {});
      else p.pending.push(msg.candidate);
    }
  }, [connect]);

  const cleanup = useCallback(() => {
    timers.current.forEach(clearInterval);
    timers.current = [];
    for (const p of peers.current.values()) p.pc.close();
    peers.current.clear();
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (channel.current) void browserClient().removeChannel(channel.current);
    channel.current = null;
    setPreview(null);
    setViewers([]);
    setWatchers(0);
  }, []);

  const totals = () => ({ peak: tally.current.peak, total: tally.current.total, watchedSeconds: Math.round(tally.current.watchedSeconds) });

  const stop = useCallback(async () => {
    const id = shareId.current;
    send({ t: "stop" });
    cleanup();
    shareId.current = null;
    setStatus("idle");
    setLink(null);
    setPaused(false);
    pausedRef.current = false;
    if (id) await endShare(id, totals());
  }, [cleanup]);

  useEffect(() => {
    stopRef.current = stop;
  }, [stop]);

  const watchEnd = (s: MediaStream) => {
    // The browser's own "Stop sharing" bar ends the share too.
    s.getVideoTracks()[0]?.addEventListener("ended", () => {
      if (stream.current === s) void stopRef.current();
    });
  };

  const start = useCallback(async () => {
    if (status !== "idle") return;
    setError(null);
    setStatus("starting");
    const res = await startShare({ leadId: d.ctx?.lead.id ?? null, callId: d.callId });
    if ("error" in res) {
      setError(res.error);
      setStatus("idle");
      return;
    }
    let s: MediaStream;
    try {
      s = await pickScreen();
    } catch {
      // Closed Chrome's picker without choosing a screen.
      await endShare(res.shareId, { peak: 0, total: 0, watchedSeconds: 0 });
      setStatus("idle");
      return;
    }
    shareId.current = res.shareId;
    ice.current = res.ice;
    stream.current = s;
    watchEnd(s);
    blocked.current = new Set();
    lockedRef.current = false;
    setLocked(false);
    tally.current = { peak: 0, total: 0, watchedSeconds: 0, seen: new Set() };
    setPreview(s);
    setLink(res.link);

    const ch = browserClient().channel(channelName(res.repId), { config: { broadcast: { self: false } } });
    ch.on("broadcast", { event: SIGNAL }, ({ payload }) => void onSignal(payload as Signal));
    ch.subscribe((st) => st === "SUBSCRIBED" && send({ t: "start" }));
    channel.current = ch;
    setStatus("live");

    // Every second: watched time and the viewer list. Every 20 seconds: check in (keeps the link live).
    timers.current.push(
      setInterval(() => {
        let now = 0;
        for (const p of peers.current.values()) {
          if (p.silent || !p.connected) continue;
          now += 1;
          if (p.stats?.visible !== false) {
            p.watchedSeconds += 1;
            tally.current.watchedSeconds += 1;
          }
        }
        tally.current.peak = Math.max(tally.current.peak, now);
        publish();
      }, 1000),
      setInterval(() => {
        if (shareId.current) void shareHeartbeat(shareId.current, totals());
      }, 20_000),
    );
  }, [status, d.ctx, d.callId, onSignal, publish]);

  const switchScreen = useCallback(async () => {
    if (status !== "live") return;
    let s: MediaStream;
    try {
      s = await pickScreen();
    } catch {
      return;
    }
    const track = s.getVideoTracks()[0];
    for (const p of peers.current.values()) {
      for (const sender of p.pc.getSenders()) if (sender.track?.kind === "video") await sender.replaceTrack(track).catch(() => {});
    }
    track.enabled = !pausedRef.current;
    const old = stream.current;
    stream.current = s;
    watchEnd(s);
    old?.getTracks().forEach((t) => t.stop());
    setPreview(s);
  }, [status]);

  const togglePause = useCallback(() => {
    const next = !pausedRef.current;
    pausedRef.current = next;
    setPaused(next);
    stream.current?.getVideoTracks().forEach((t) => (t.enabled = !next));
    for (const p of peers.current.values()) if (p.dc.readyState === "open") p.dc.send(JSON.stringify({ paused: next } satisfies RepNotice));
  }, []);

  const toggleLock = useCallback(() => {
    lockedRef.current = !lockedRef.current;
    setLocked(lockedRef.current);
  }, []);

  const remove = useCallback((id: string) => {
    blocked.current.add(id);
    send({ t: "removed", to: id });
    drop(id);
  }, [drop]);

  // Closing the tab ends the share.
  useEffect(() => {
    if (status !== "live") return;
    const bye = () => {
      send({ t: "stop" });
    };
    window.addEventListener("pagehide", bye);
    return () => window.removeEventListener("pagehide", bye);
  }, [status]);

  return (
    <ShareContext.Provider
      value={{ status, error, link, preview, viewers, watchers, locked, paused, start, stop, switchScreen, togglePause, toggleLock, remove, clearError: () => setError(null) }}
    >
      {children}
    </ShareContext.Provider>
  );
}
