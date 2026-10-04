import { describe, expect, it } from "vitest";
import { addDays, duration, pct, resolveRange, zonedMidnight } from "./stats";

describe("time ranges in Eastern time", () => {
  it("midnight Eastern in summer (EDT, UTC-4) and winter (EST, UTC-5)", () => {
    expect(zonedMidnight("2026-10-05").toISOString()).toBe("2026-10-05T04:00:00.000Z");
    expect(zonedMidnight("2026-12-01").toISOString()).toBe("2026-12-01T05:00:00.000Z");
    expect(zonedMidnight("2026-11-01").toISOString()).toBe("2026-11-01T04:00:00.000Z"); // DST ends that morning
  });
  it("today / week / month", () => {
    const now = new Date("2026-10-07T15:00:00Z"); // Wednesday
    expect(resolveRange("today", undefined, undefined, now)).toMatchObject({ fromDay: "2026-10-07", toDay: "2026-10-07" });
    expect(resolveRange("week", undefined, undefined, now)).toMatchObject({ fromDay: "2026-10-05", toDay: "2026-10-07" });
    expect(resolveRange("month", undefined, undefined, now)).toMatchObject({ fromDay: "2026-10-01" });
  });
  it("late evening Eastern is still 'today' even though UTC is tomorrow", () => {
    const now = new Date("2026-10-08T02:30:00Z"); // 10:30pm Oct 7 Eastern
    expect(resolveRange("today", undefined, undefined, now).fromDay).toBe("2026-10-07");
  });
  it("custom range validates input", () => {
    expect(resolveRange("custom", "2026-09-01", "2026-09-30").key).toBe("custom");
    expect(resolveRange("custom", "2026-09-30", "2026-09-01").key).toBe("today");
  });
  it("helpers", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(pct(1, 3)).toBe("33%");
    expect(pct(1, 0)).toBe("—");
    expect(duration(3725)).toBe("1h 2m");
    expect(duration(95)).toBe("1m 35s");
  });
});
