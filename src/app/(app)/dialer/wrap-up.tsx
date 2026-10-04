"use client";

import { useMemo, useState } from "react";
import { Alert, Button, Card, Field, Input, Select } from "@/components/ui";

type DispositionKey = "no_answer" | "not_interested" | "appointment_set" | "demo_completed" | "sold" | "do_not_call" | "bad_number";
type PauseReason = "lunch" | "break" | "meeting" | "training" | "other";

export type Disposition = {
  disposition: DispositionKey;
  note?: string;
  appointmentStart?: string | null;
  appointmentMinutes?: number | null;
  pauseAfter?: PauseReason | null;
};

const OPTIONS: { key: DispositionKey; label: string; style: string }[] = [
  { key: "no_answer", label: "No answer", style: "ring-gray-300 hover:bg-gray-50" },
  { key: "not_interested", label: "Not interested", style: "ring-gray-300 hover:bg-gray-50" },
  { key: "appointment_set", label: "Appointment set", style: "ring-green-300 text-green-800 hover:bg-green-50" },
  { key: "demo_completed", label: "Demo completed", style: "ring-green-300 text-green-800 hover:bg-green-50" },
  { key: "sold", label: "Sold", style: "ring-green-400 text-green-900 bg-green-50 hover:bg-green-100" },
  { key: "do_not_call", label: "Do Not Call", style: "ring-red-300 text-red-700 hover:bg-red-50" },
  { key: "bad_number", label: "Bad number", style: "ring-red-200 text-red-700 hover:bg-red-50" },
];

function defaultAppointmentValue() {
  // Next weekday at 10:00 in the rep's own time, as a datetime-local value.
  const d = new Date();
  do d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6);
  d.setHours(10, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T10:00`;
}

export function WrapUp({
  busy,
  hadCall,
  leadTimezone,
  showPauseAfter,
  onSubmit,
  onBack,
}: {
  busy: boolean;
  hadCall: boolean;
  leadTimezone: string | null;
  showPauseAfter: boolean;
  onSubmit: (d: Disposition) => void;
  onBack?: () => void;
}) {
  const [choice, setChoice] = useState<DispositionKey | null>(null);
  const [note, setNote] = useState("");
  const [apptLocal, setApptLocal] = useState(defaultAppointmentValue);
  const [apptMinutes, setApptMinutes] = useState(30);
  const [pauseAfter, setPauseAfter] = useState<PauseReason | "">("");
  const [problem, setProblem] = useState<string | null>(null);

  const apptDate = useMemo(() => (apptLocal ? new Date(apptLocal) : null), [apptLocal]);
  const leadTime =
    apptDate && leadTimezone && !Number.isNaN(apptDate.getTime())
      ? apptDate.toLocaleString("en-US", { timeZone: leadTimezone, weekday: "short", hour: "numeric", minute: "2-digit" })
      : null;

  function submit() {
    if (!choice) return setProblem("Pick an outcome.");
    if (choice === "appointment_set" && (!apptDate || Number.isNaN(apptDate.getTime()))) return setProblem("Pick the appointment date and time.");
    if (choice === "do_not_call" && !window.confirm("Add this number to Do Not Call permanently? It can never be called again.")) return;
    setProblem(null);
    onSubmit({
      disposition: choice,
      note: note.trim() || undefined,
      appointmentStart: choice === "appointment_set" && apptDate ? apptDate.toISOString() : null,
      appointmentMinutes: choice === "appointment_set" ? apptMinutes : null,
      pauseAfter: pauseAfter || null,
    });
  }

  return (
    <Card className="ring-2 ring-brand-500">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900">{hadCall ? "Call ended. How did it go?" : "Pick an outcome"}</h3>
        {onBack && <button onClick={onBack} className="text-sm text-gray-500 hover:underline">Back</button>}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {OPTIONS.map((o) => (
          <button
            key={o.key}
            onClick={() => setChoice(o.key)}
            className={`rounded-lg px-3 py-3 text-sm font-medium ring-1 transition ${o.style} ${choice === o.key ? "ring-2 ring-brand-600 outline-none" : ""}`}
            aria-pressed={choice === o.key}
          >
            {o.label}
          </button>
        ))}
      </div>

      {choice === "appointment_set" && (
        <div className="mt-4 grid gap-3 rounded-lg bg-green-50 p-4 ring-1 ring-green-200 sm:grid-cols-[1fr_8rem]">
          <Field label="Appointment (your time)" htmlFor="appt" hint={leadTime ? `That's ${leadTime} for them.` : undefined}>
            <Input id="appt" type="datetime-local" value={apptLocal} onChange={(e) => setApptLocal(e.target.value)} />
          </Field>
          <Field label="Length" htmlFor="apptMinutes">
            <Select id="apptMinutes" value={apptMinutes} onChange={(e) => setApptMinutes(Number(e.target.value))}>
              {[15, 30, 45, 60].map((m) => <option key={m} value={m}>{m} min</option>)}
            </Select>
          </Field>
        </div>
      )}

      {choice === "sold" && (
        <p className="mt-4 rounded-lg bg-green-50 p-3 text-sm text-green-900 ring-1 ring-green-200">
          Great work! If you haven&apos;t yet, use <b>Take payment</b> above first. The sale only counts once Stripe confirms the payment.
        </p>
      )}

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder="Note (optional)"
        className="mt-4 block w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm ring-1 ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-brand-500 focus:outline-none"
      />

      {problem && <div className="mt-3"><Alert>{problem}</Alert></div>}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button onClick={submit} disabled={busy || !choice}>{busy ? "Saving…" : showPauseAfter ? "Save & next lead" : "Save"}</Button>
        {showPauseAfter && (
          <Select value={pauseAfter} onChange={(e) => setPauseAfter(e.target.value as PauseReason | "")} className="w-auto" aria-label="Pause after saving">
            <option value="">Keep dialing</option>
            <option value="break">Then pause: break</option>
            <option value="lunch">Then pause: lunch</option>
            <option value="meeting">Then pause: meeting</option>
            <option value="training">Then pause: training</option>
            <option value="other">Then pause: other</option>
          </Select>
        )}
      </div>
    </Card>
  );
}
