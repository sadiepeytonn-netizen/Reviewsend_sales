"use client";

import { useState } from "react";
import { Star } from "lucide-react";
import { setRecordingStar } from "./actions";

/** Admin's star toggle on a recording. Starring asks for an optional note for the reps. */
export function StarButton({ callId, starred, note }: { callId: string; starred: boolean; note: string | null }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      onClick={async () => {
        let text: string | undefined;
        if (!starred) {
          const answer = window.prompt("Star this call for the reps. What should they listen for? (optional)", note ?? "");
          if (answer === null) return;
          text = answer;
        }
        setBusy(true);
        const res = await setRecordingStar(callId, !starred, text);
        setBusy(false);
        if (res.error) window.alert(res.error);
      }}
      className={`shrink-0 rounded p-1 ${starred ? "text-amber-500 hover:text-amber-600" : "text-gray-300 hover:text-amber-500"}`}
      title={starred ? "Starred for the reps. Click to un-star." : "Star this call for the reps to listen to"}
      aria-label={starred ? "Un-star recording" : "Star recording"}
      aria-pressed={starred}
    >
      <Star className="h-5 w-5" fill={starred ? "currentColor" : "none"} />
    </button>
  );
}
