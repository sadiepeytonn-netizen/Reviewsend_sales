import { describe, expect, it } from "vitest";
import { formatPhone, listForTimezone, locate, normalizePhone, normalizeState } from "./index";

describe("normalizePhone", () => {
  it("handles common formats", () => {
    expect(normalizePhone("(954) 821-7880")).toBe("+19548217880");
    expect(normalizePhone("754-226-6934")).toBe("+17542266934");
    expect(normalizePhone("+1 503 444 9637")).toBe("+15034449637");
    expect(normalizePhone("15034449637")).toBe("+15034449637");
  });
  it("rejects junk and non-US", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("555-1234")).toBeNull();
    expect(normalizePhone("(123) 456-7890")).toBeNull();
    expect(normalizePhone("+44 20 7946 0958")).toBeNull();
    expect(normalizePhone("(416) 555-0199")).toBeNull(); // Toronto
  });
  it("formats for display", () => {
    expect(formatPhone("+19548217880")).toBe("(954) 821-7880");
  });
});

describe("locate + list", () => {
  it("uses the area code", () => {
    expect(locate("+19548217880")).toEqual({ state: "FL", timezone: "America/New_York" });
    expect(locate("+15034449637").timezone).toBe("America/Los_Angeles");
    expect(locate("+18013016611").state).toBe("UT");
  });
  it("splits area codes by exchange (FL panhandle)", () => {
    expect(locate("+18504350000").timezone).toBe("America/Chicago"); // Pensacola
    expect(locate("+18502100000").timezone).toBe("America/New_York"); // Tallahassee
  });
  it("prefers the state column when given", () => {
    expect(locate("+19548217880", "Georgia").state).toBe("GA");
  });
  it("assigns EAST/WEST", () => {
    expect(listForTimezone("America/New_York")).toBe("EAST");
    expect(listForTimezone("America/Chicago")).toBe("EAST");
    expect(listForTimezone("America/North_Dakota/Center")).toBe("EAST");
    expect(listForTimezone("America/Denver")).toBe("WEST");
    expect(listForTimezone("America/Phoenix")).toBe("WEST");
    expect(listForTimezone("America/Los_Angeles")).toBe("WEST");
    expect(listForTimezone("America/Anchorage")).toBe("WEST");
    expect(listForTimezone("Pacific/Honolulu")).toBe("WEST");
    expect(listForTimezone(null)).toBeNull();
  });
  it("normalizes states", () => {
    expect(normalizeState("fl")).toBe("FL");
    expect(normalizeState("New York")).toBe("NY");
    expect(normalizeState("Ontario")).toBeNull();
  });
});
