"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { watchPass } from "./actions";
import { ShareViewer } from "./viewer";

/** From Live: watch a rep's screen share exactly as their prospect sees it. The rep isn't told. */
export function WatchScreen({ repId, name, onClose }: { repId: string; name: string; onClose: () => void }) {
  const [access, setAccess] = useState<{ pass: string; ice: RTCIceServer[] } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void watchPass(repId).then((r) => {
      if (!live) return;
      if (r.pass && r.ice) setAccess({ pass: r.pass, ice: r.ice });
      else setProblem(r.error ?? "Can't watch right now.");
    });
    return () => {
      live = false;
    };
  }, [repId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-5xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between text-white">
          <p className="text-sm font-semibold">{name}&apos;s screen, as their prospect sees it</p>
          <button onClick={onClose} className="rounded p-1 text-white/70 hover:bg-white/10" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        {problem ? (
          <p className="rounded-xl bg-white p-6 text-sm text-gray-700">{problem}</p>
        ) : access ? (
          <ShareViewer repId={repId} repName={name.split(" ")[0]} pass={access.pass} ice={access.ice} embedded />
        ) : (
          <p className="rounded-xl bg-white p-6 text-sm text-gray-500">Connecting…</p>
        )}
      </div>
    </div>
  );
}
