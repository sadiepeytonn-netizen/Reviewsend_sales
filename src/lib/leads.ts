export type LeadStatus =
  | "new" | "no_answer" | "not_interested" | "appointment_set" | "demo_completed"
  | "sold" | "do_not_call" | "bad_number" | "exhausted" | "removed";

export const STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New",
  no_answer: "No answer (retry)",
  not_interested: "Not interested",
  appointment_set: "Appointment set",
  demo_completed: "Demo completed",
  sold: "Sold",
  do_not_call: "Do Not Call",
  bad_number: "Bad number",
  exhausted: "Exhausted",
  removed: "Removed",
};

export const STATUS_TONES: Record<LeadStatus, "gray" | "green" | "red" | "blue" | "amber"> = {
  new: "blue",
  no_answer: "amber",
  not_interested: "gray",
  appointment_set: "green",
  demo_completed: "green",
  sold: "green",
  do_not_call: "red",
  bad_number: "red",
  exhausted: "gray",
  removed: "gray",
};

export const TIMEZONE_LABELS: Record<string, string> = {
  "America/New_York": "Eastern",
  "America/Detroit": "Eastern",
  "America/Indiana/Indianapolis": "Eastern",
  "America/Kentucky/Louisville": "Eastern",
  "America/Chicago": "Central",
  "America/Indiana/Knox": "Central",
  "America/Menominee": "Central",
  "America/North_Dakota/Center": "Central",
  "America/Denver": "Mountain",
  "America/Boise": "Mountain",
  "America/Phoenix": "Arizona (no DST)",
  "America/Los_Angeles": "Pacific",
  "America/Anchorage": "Alaska",
  "America/Juneau": "Alaska",
  "America/Adak": "Hawaii-Aleutian",
  "Pacific/Honolulu": "Hawaii",
};

export function timezoneLabel(tz: string | null): string {
  if (!tz) return "Unknown";
  return TIMEZONE_LABELS[tz] ?? tz.replace(/^America\//, "").replace(/_/g, " ");
}
