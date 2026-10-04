// All dates in the CRM are shown in the business's time zone, the same on the
// server and in the browser (otherwise server-rendered pages would show UTC).
export const APP_TIME_ZONE = "America/New_York";

const PRESETS = {
  datetime: { dateStyle: "medium", timeStyle: "short" },
  date: { dateStyle: "medium" },
  short: { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" },
} satisfies Record<string, Intl.DateTimeFormatOptions>;

export function formatTime(iso: string | Date | null | undefined, preset: keyof typeof PRESETS = "datetime"): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", { ...PRESETS[preset], timeZone: APP_TIME_ZONE });
}
