"use client";

import { useState } from "react";
import { Alert, Button, Input, Select } from "@/components/ui";
import { reschedule, setOutcome } from "./actions";

type Status = "scheduled" | "showed" | "missed" | "canceled" | "rescheduled";

export const APPOINTMENT_LABELS: Record<Status, string> = {
  scheduled: "Scheduled",
  showed: "Showed",
  missed: "Demo missed",
  canceled: "Canceled",
  rescheduled: "Rescheduled",
};

function toLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Showed / Demo missed / Canceled / Reschedule buttons for one appointment. */
export function AppointmentActions({
  appointment,
  onChanged,
  compact = false,
}: {
  appointment: { id: string; starts_at: string; ends_at: string; status: Status };
  onChanged?: () => void;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [when, setWhen] = useState(() => toLocalInput(appointment.starts_at));
  const [minutes, setMinutes] = useState(
    Math.round((Date.parse(appointment.ends_at) - Date.parse(appointment.starts_at)) / 60_000) || 30,
  );

  async function run(fn: () => Promise<{ error?: string }>) {
    setBusy(true);
    setError(null);
    const res = await fn();
    setBusy(false);
    if (res.error) setError(res.error);
    else {
      setMoving(false);
      onChanged?.();
    }
  }

  const s = appointment.status;
  return (
    <div className="space-y-2">
      {error && <Alert>{error}</Alert>}
      <div className="flex flex-wrap gap-2">
        {s !== "showed" && (
          <Button variant="secondary" className={compact ? "px-2.5 py-1 text-xs" : ""} disabled={busy}
            onClick={() => run(() => setOutcome(appointment.id, "showed"))}>Showed</Button>
        )}
        {s !== "missed" && (
          <Button variant="secondary" className={`text-red-700 ${compact ? "px-2.5 py-1 text-xs" : ""}`} disabled={busy}
            onClick={() => run(() => setOutcome(appointment.id, "missed"))}>Demo missed</Button>
        )}
        {s === "scheduled" && (
          <Button variant="ghost" className={compact ? "px-2.5 py-1 text-xs" : ""} disabled={busy}
            onClick={() => window.confirm("Cancel this appointment?") && run(() => setOutcome(appointment.id, "canceled"))}>Cancel</Button>
        )}
        {s !== "scheduled" && (
          <Button variant="ghost" className={compact ? "px-2.5 py-1 text-xs" : ""} disabled={busy}
            onClick={() => run(() => setOutcome(appointment.id, "scheduled"))}>Undo</Button>
        )}
        <Button variant="ghost" className={compact ? "px-2.5 py-1 text-xs" : ""} disabled={busy} onClick={() => setMoving((v) => !v)}>
          Reschedule
        </Button>
      </div>
      {moving && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg bg-gray-50 p-3 ring-1 ring-gray-200">
          <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="w-auto" aria-label="New time" />
          <Select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="w-auto" aria-label="Length">
            {[15, 30, 45, 60].map((m) => <option key={m} value={m}>{m} min</option>)}
          </Select>
          <Button disabled={busy || !when} onClick={() => run(() => reschedule(appointment.id, new Date(when).toISOString(), minutes))}>
            Save new time
          </Button>
        </div>
      )}
    </div>
  );
}
