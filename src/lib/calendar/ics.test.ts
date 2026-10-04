import { describe, expect, it } from "vitest";
import { buildIcs, escapeText, fold } from "./ics";

describe("ics", () => {
  it("escapes special characters", () => {
    expect(escapeText("Smith, Jones; Co\nLine 2")).toBe("Smith\\, Jones\; Co\\nLine 2");
  });
  it("folds long lines at 75 bytes", () => {
    const folded = fold("SUMMARY:" + "x".repeat(200));
    for (const part of folded.split("\r\n")) expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, "")).toBe("SUMMARY:" + "x".repeat(200));
  });
  it("builds a calendar with UTC times", () => {
    const ics = buildIcs("Demos", [
      { uid: "a1@x", start: new Date("2026-10-05T14:00:00Z"), end: new Date("2026-10-05T14:30:00Z"), summary: "Demo: Blue Magic Pools" },
    ], new Date("2026-10-04T00:00:00Z"));
    expect(ics).toContain("DTSTART:20261005T140000Z");
    expect(ics).toContain("DTEND:20261005T143000Z");
    expect(ics).toContain("SUMMARY:Demo: Blue Magic Pools");
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
});
