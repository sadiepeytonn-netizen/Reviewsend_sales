"use client";

import { useEffect } from "react";
import { heartbeat } from "@/app/(app)/dialer/actions";

// Tells the server "still here" once a minute while any CRM page is open.
// This is what "time logged in" stats are built from.
export function Heartbeat() {
  useEffect(() => {
    void heartbeat();
    const t = setInterval(() => {
      if (document.visibilityState !== "hidden") void heartbeat();
    }, 60_000);
    return () => clearInterval(t);
  }, []);
  return null;
}
