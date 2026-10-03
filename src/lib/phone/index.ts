import { parsePhoneNumberFromString } from "libphonenumber-js/min";
import { AREA_CODES, TZ_PREFIXES } from "./area-code-data";

export type LeadList = "EAST" | "WEST";

/** "(954) 821-7880" -> "+19548217880". US numbers only; anything else -> null. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const parsed = parsePhoneNumberFromString(String(raw), "US");
  if (!parsed || parsed.country !== "US" || !parsed.isValid()) return null;
  return parsed.number;
}

/** "+19548217880" -> "(954) 821-7880" */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  const d = e164.replace(/^\+1/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : e164;
}

const STATE_NAMES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO",
  connecticut: "CT", delaware: "DE", "district of columbia": "DC", "washington dc": "DC", florida: "FL",
  georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS",
  kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI",
  minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC",
  "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
};
const STATE_CODES = new Set(Object.values(STATE_NAMES));

/** "Florida" / "fl" / "FL" -> "FL"; unknown -> null */
export function normalizeState(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = input.trim().replace(/\./g, "");
  if (STATE_CODES.has(s.toUpperCase())) return s.toUpperCase();
  return STATE_NAMES[s.toLowerCase()] ?? null;
}

// Main time zone of each state, used only when the area code is unknown.
const STATE_TIMEZONES: Record<string, string> = {
  AL: "America/Chicago", AK: "America/Anchorage", AZ: "America/Phoenix", AR: "America/Chicago",
  CA: "America/Los_Angeles", CO: "America/Denver", CT: "America/New_York", DE: "America/New_York",
  DC: "America/New_York", FL: "America/New_York", GA: "America/New_York", HI: "Pacific/Honolulu",
  ID: "America/Boise", IL: "America/Chicago", IN: "America/Indiana/Indianapolis", IA: "America/Chicago",
  KS: "America/Chicago", KY: "America/New_York", LA: "America/Chicago", ME: "America/New_York",
  MD: "America/New_York", MA: "America/New_York", MI: "America/Detroit", MN: "America/Chicago",
  MS: "America/Chicago", MO: "America/Chicago", MT: "America/Denver", NE: "America/Chicago",
  NV: "America/Los_Angeles", NH: "America/New_York", NJ: "America/New_York", NM: "America/Denver",
  NY: "America/New_York", NC: "America/New_York", ND: "America/Chicago", OH: "America/New_York",
  OK: "America/Chicago", OR: "America/Los_Angeles", PA: "America/New_York", RI: "America/New_York",
  SC: "America/New_York", SD: "America/Chicago", TN: "America/Chicago", TX: "America/Chicago",
  UT: "America/Denver", VT: "America/New_York", VA: "America/New_York", WA: "America/Los_Angeles",
  WV: "America/New_York", WI: "America/Chicago", WY: "America/Denver",
};

/**
 * Where a number is, from its area code (and exchange, for area codes split
 * across time zones). Falls back to the state column if the area code is unknown.
 */
export function locate(e164: string, stateHint?: string | null): { state: string | null; timezone: string | null } {
  const national = e164.replace(/^\+1/, "");
  const area = AREA_CODES[national.slice(0, 3)];
  let timezone: string | null = area?.[1] ?? null;
  for (let len = 7; len > 3; len--) {
    const zone = TZ_PREFIXES[national.slice(0, len)];
    if (zone) {
      timezone = zone;
      break;
    }
  }
  const state = normalizeState(stateHint) ?? area?.[0] ?? null;
  if (!timezone && state) timezone = STATE_TIMEZONES[state] ?? null;
  return { state, timezone };
}

/** EAST = Eastern + Central; WEST = Mountain, Pacific, Alaska, Hawaii. */
export function listForTimezone(timezone: string | null): LeadList | null {
  if (!timezone) return null;
  // Standard-time offset in January (avoids daylight-saving differences).
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "shortOffset" })
    .formatToParts(new Date(Date.UTC(2026, 0, 15, 12)))
    .find((p) => p.type === "timeZoneName")?.value; // e.g. "GMT-6"
  const m = parts?.match(/GMT([+-]\d+)(?::(\d+))?/);
  if (!m) return null;
  const hours = Number(m[1]);
  return hours >= -6 ? "EAST" : "WEST";
}
