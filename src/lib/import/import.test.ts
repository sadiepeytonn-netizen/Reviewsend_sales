import { describe, expect, it } from "vitest";
import { cleanRow } from "./clean";
import { guessMapping, mappingProblems } from "./fields";

const HUBSPOT = ["Record ID", "Company name", "Create Date", "Phone Number", "Last Activity Date", "City", "Country/Region", "Industry", "Lead Status", "Company owner"];

describe("guessMapping", () => {
  it("maps the HubSpot export", () => {
    const m = guessMapping(HUBSPOT);
    expect(m["Company name"]).toBe("business_name");
    expect(m["Phone Number"]).toBe("phone");
    expect(m["City"]).toBe("city");
    expect(m["Industry"]).toBe("category");
    expect(m["Record ID"]).toBe("");
    expect(m["Lead Status"]).toBe("");
    // HubSpot's "Company owner" is the HubSpot user, NOT the business owner.
    expect(m["Company owner"]).toBe("");
    expect(mappingProblems(m)).toEqual([]);
  });
  it("flags missing required columns", () => {
    expect(mappingProblems(guessMapping(["City"]))).toHaveLength(2);
  });
});

describe("owner name columns", () => {
  it("maps owner columns from vendor files", () => {
    expect(guessMapping(["Business", "Phone", "Owner Name"])["Owner Name"]).toBe("contact_name");
    expect(guessMapping(["Business", "Phone", "Owner"])["Owner"]).toBe("contact_name");
  });
});

describe("cleanRow", () => {
  it("cleans a HubSpot row", () => {
    const r = cleanRow({ business_name: " 3N1  Services ", phone: "(954) 821-7880", city: "Deerfield Beach", category: "Consumer Services" });
    expect(r).toMatchObject({
      business_name: "3N1 Services",
      phone_e164: "+19548217880",
      state: "FL",
      timezone: "America/New_York",
      list: "EAST",
    });
    expect(r.invalid_reason).toBeUndefined();
  });
  it("puts Oregon on WEST", () => {
    expect(cleanRow({ business_name: "Callahan Electric", phone: "503-421-4553" }).list).toBe("WEST");
  });
  it("joins first + last name and parses numbers", () => {
    const r = cleanRow({ business_name: "X", phone: "9548217880", contact_first_name: "Ana", contact_last_name: "Diaz", google_rating: "4.7", review_count: "1,204" });
    expect(r.contact_name).toBe("Ana Diaz");
    expect(r.google_rating).toBe(4.7);
    expect(r.review_count).toBe(1204);
  });
  it("explains invalid rows", () => {
    expect(cleanRow({ business_name: "X" }).invalid_reason).toBe("No phone number");
    expect(cleanRow({ business_name: "X", phone: "555-1234" }).invalid_reason).toBe("Not a valid US phone number");
    expect(cleanRow({ phone: "9548217880" }).invalid_reason).toBe("No business name");
  });
});
