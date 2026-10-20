"use client";

import { useEffect, useRef, useState } from "react";
import { Maximize, RotateCw } from "lucide-react";
import { browserClient } from "@/lib/supabase/browser";
import { SIGNAL, channelName, describeDevice, type RepNotice, type Signal, type ViewerStats } from "@/lib/share/protocol";

type Phase = "waiting" | "connecting" | "live" | "ended" | "removed" | "locked";

const TZ_PLACES: Record<string, string> = {
  "America/New_York": "Eastern time", "America/Detroit": "Eastern time", "America/Chicago": "Central time",
  "America/Denver": "Mountain time", "America/Phoenix": "Arizona", "America/Los_Angeles": "Pacific time",
  "America/Anchorage": "Alaska", "Pacific/Honolulu": "Hawaii",
};

/**
 * Watches a rep's screen. Used by prospects on reviewsend.io/<rep> (no sign-in) and, with a
 * `pass`, by admins watching silently from Live.
 */
export function ShareViewer({
  repId,
  repName,
  pass,
  ice,
  embedded = false,
}: {
  repId: string;
  repName: string;
  pass?: string;
  ice?: RTCIceServer[];
  embedded?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>("waiting");
  const [paused, setPaused] = useState(false);
  const [portraitPhone, setPortraitPhone] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const myId = crypto.randomUUID();
    const ch = browserClient().channel(channelName(repId), { config: { broadcast: { self: false } } });
    const device = describeDevice(navigator.userAgent, navigator.maxTouchPoints > 0, Math.min(screen.width, screen.height));
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const place = TZ_PLACES[tz] ?? tz.split("/").pop()?.replace(/_/g, " ") ?? null;
    let pc: RTCPeerConnection | null = null;
    let dc: RTCDataChannel | null = null; // stats back to the rep, "paused" notices from the rep
    let pending: RTCIceCandidateInit[] = [];
    let iceServers: RTCIceServer[] | null = ice ?? null;
    let done = false;
    let lastLost = 0;
    let lastRecv = 0;

    const send = (msg: Signal) => void ch.send({ type: "broadcast", event: SIGNAL, payload: msg });
    const hello = () => send({ t: "hello", from: myId, device, place, pass });
    const close = () => {
      pc?.close();
      pc = null;
      dc = null;
      pending = [];
    };
    const servers = async () => {
      if (!iceServers) {
        try {
          const r = await fetch(`/api/share/ice?rep=${repId}`, { cache: "no-store" });
          iceServers = ((await r.json()) as { iceServers: RTCIceServer[] }).iceServers;
        } catch {
          return [{ urls: "stun:stun.l.google.com:19302" }];
        }
      }
      return iceServers;
    };

    async function onOffer(sdp: string) {
      close();
      setPhase("connecting");
      const conn = new RTCPeerConnection({ iceServers: await servers() });
      pc = conn;
      conn.ontrack = (e) => {
        if (videoRef.current) {
          videoRef.current.srcObject = e.streams[0] ?? new MediaStream([e.track]);
          void videoRef.current.play().catch(() => {});
        }
        setPhase("live");
      };
      conn.onicecandidate = (e) => e.candidate && send({ t: "ice", from: myId, candidate: e.candidate.toJSON() });
      conn.onconnectionstatechange = () => {
        if (conn.connectionState === "failed") {
          close();
          setPhase("connecting");
          hello(); // the rep sends a fresh offer
        }
      };
      conn.ondatachannel = (e) => {
        dc = e.channel;
        dc.onmessage = (m) => {
          try {
            setPaused(Boolean((JSON.parse(String(m.data)) as RepNotice).paused));
          } catch {}
        };
      };
      await conn.setRemoteDescription({ type: "offer", sdp });
      const answer = await conn.createAnswer();
      await conn.setLocalDescription(answer);
      send({ t: "answer", from: myId, sdp: answer.sdp ?? "" });
      for (const c of pending) await conn.addIceCandidate(c).catch(() => {});
      pending = [];
    }

    ch.on("broadcast", { event: SIGNAL }, ({ payload }) => {
      const msg = payload as Signal;
      if (done) return;
      if (msg.t === "start") {
        if (!pc) hello();
      } else if (msg.t === "stop") {
        close();
        setPaused(false);
        setPhase("ended");
      } else if (msg.t === "offer" && msg.to === myId) {
        void onOffer(msg.sdp);
      } else if (msg.t === "ice" && msg.to === myId) {
        if (pc?.remoteDescription) void pc.addIceCandidate(msg.candidate).catch(() => {});
        else pending.push(msg.candidate);
      } else if ((msg.t === "removed" || msg.t === "locked") && msg.to === myId) {
        done = true;
        close();
        setPhase(msg.t);
      }
    });
    ch.subscribe((status) => status === "SUBSCRIBED" && hello());

    // Until connected, keep saying hello (covers arriving before the rep starts).
    const helloTimer = setInterval(() => !done && !pc && hello(), 4000);

    // Every 2 seconds: what the viewer's screen looks like and how the video is arriving.
    const statsTimer = setInterval(async () => {
      const conn = pc;
      setPortraitPhone(device.kind !== "computer" && matchMedia("(orientation: portrait)").matches);
      if (!conn || conn.connectionState !== "connected") return;
      const report = await conn.getStats();
      let fps = 0, frameW = 0, frameH = 0, rtt: number | null = null, buffer: number | null = null, lossPct = 0;
      report.forEach((r) => {
        if (r.type === "inbound-rtp" && r.kind === "video") {
          fps = r.framesPerSecond ?? 0;
          frameW = r.frameWidth ?? 0;
          frameH = r.frameHeight ?? 0;
          if (r.jitterBufferEmittedCount) buffer = r.jitterBufferDelay / r.jitterBufferEmittedCount;
          const lost = (r.packetsLost ?? 0) - lastLost;
          const recv = (r.packetsReceived ?? 0) - lastRecv;
          lossPct = lost + recv > 0 ? (100 * Math.max(0, lost)) / (lost + recv) : 0;
          lastLost = r.packetsLost ?? 0;
          lastRecv = r.packetsReceived ?? 0;
        }
        if (r.type === "candidate-pair" && r.nominated && r.state === "succeeded" && r.currentRoundTripTime != null) rtt = r.currentRoundTripTime;
      });
      const v = videoRef.current as (HTMLVideoElement & { webkitDisplayingFullscreen?: boolean }) | null;
      const stats: ViewerStats = {
        vw: innerWidth, vh: innerHeight, sw: screen.width, sh: screen.height,
        portrait: matchMedia("(orientation: portrait)").matches,
        fullscreen: Boolean(document.fullscreenElement || v?.webkitDisplayingFullscreen || (innerHeight >= screen.height - 4 && innerWidth >= screen.width - 4)),
        visible: document.visibilityState === "visible",
        fps, frameW, frameH, rtt, buffer, lossPct,
      };
      if (dc?.readyState === "open") dc.send(JSON.stringify(stats));
    }, 2000);

    const bye = () => close();
    window.addEventListener("pagehide", bye);
    return () => {
      done = true;
      clearInterval(helloTimer);
      clearInterval(statsTimer);
      window.removeEventListener("pagehide", bye);
      close();
      void browserClient().removeChannel(ch);
    };
  }, [repId, pass, ice]);

  function fullScreen() {
    const v = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    const box = boxRef.current;
    if (box?.requestFullscreen) void box.requestFullscreen().catch(() => v?.webkitEnterFullscreen?.());
    else v?.webkitEnterFullscreen?.(); // iPhone
  }

  const message =
    phase === "waiting" ? `${repName} will start sharing in a moment…`
    : phase === "connecting" ? `Connecting to ${repName}'s screen…`
    : phase === "ended" ? `${repName} stopped sharing. If they share again, it will show up here automatically.`
    : phase === "removed" ? "This presentation has ended."
    : phase === "locked" ? "This presentation is private right now."
    : "";

  return (
    <div ref={boxRef} className={`relative flex flex-col bg-[#14171F] ${embedded ? "h-[70vh] rounded-xl" : "h-dvh"}`}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={`min-h-0 w-full flex-1 object-contain ${phase === "live" ? "" : "hidden"}`}
      />
      {phase !== "live" && (
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#E3A94C]">★ ReviewSend</p>
          <p className="mt-4 max-w-md text-xl font-semibold text-white">{message}</p>
          {(phase === "waiting" || phase === "connecting" || phase === "ended") && (
            <span className="mt-6 h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white" />
          )}
          {!embedded && phase === "waiting" && (
            <p className="mt-6 max-w-sm text-sm text-white/60">Nothing to download or sign into. Keep this page open; the screen appears here on its own.</p>
          )}
        </div>
      )}
      {phase === "live" && paused && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70 text-lg font-semibold text-white">Paused, one moment…</div>
      )}
      {phase === "live" && portraitPhone && !embedded && (
        <div className="absolute inset-x-3 top-3 flex items-center gap-2 rounded-lg bg-[#E3A94C] px-3 py-2 text-sm font-semibold text-[#14171F] shadow-lg">
          <RotateCw className="h-4 w-4 shrink-0" /> Turn your phone sideways for a bigger view
        </div>
      )}
      {phase === "live" && (
        <div className="flex items-center justify-between gap-3 bg-black/60 px-3 py-2 text-xs text-white/80">
          <span>
            <span className="text-[#E3A94C]">★ ReviewSend</span> · Watching {repName}&apos;s screen
          </span>
          {!embedded && (
            <button onClick={fullScreen} className="inline-flex items-center gap-1.5 rounded-md bg-white/15 px-3 py-1.5 font-semibold text-white hover:bg-white/25">
              <Maximize className="h-4 w-4" /> Full screen
            </button>
          )}
        </div>
      )}
    </div>
  );
}
