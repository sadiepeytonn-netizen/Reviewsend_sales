"use client";

import { useRouter } from "next/navigation";
import { Badge, Card } from "@/components/ui";
import { APPOINTMENT_LABELS, AppointmentActions } from "../../calendar/appointment-actions";
import { formatTime } from "@/lib/time";

type Appt = { id: string; starts_at: string; ends_at: string; status: keyof typeof APPOINTMENT_LABELS };

export function LeadAppointments({ appointments, canEdit }: { appointments: Appt[]; canEdit: boolean }) {
  const router = useRouter();
  return (
    <Card>
      <h3 className="mb-3 font-medium text-gray-900">Appointments</h3>
      <ul className="divide-y divide-gray-100 text-sm">
        {appointments.map((a) => (
          <li key={a.id} className="space-y-2 py-3">
            <div className="flex items-center justify-between gap-2">
              <span className={a.status === "rescheduled" || a.status === "canceled" ? "text-gray-400 line-through" : "text-gray-900"}>
                {formatTime(a.starts_at, "short")}
              </span>
              <Badge tone={a.status === "scheduled" ? "blue" : a.status === "showed" ? "green" : a.status === "missed" ? "red" : "gray"}>
                {APPOINTMENT_LABELS[a.status]}
              </Badge>
            </div>
            {canEdit && a.status !== "rescheduled" && (
              <AppointmentActions appointment={a} compact onChanged={() => router.refresh()} />
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
