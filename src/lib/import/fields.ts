// The lead fields a CSV column can be matched to, plus how to guess the
// match from common column names (HubSpot and typical lead-vendor exports).

export const LEAD_FIELDS = [
  { key: "business_name", label: "Business name", required: true, synonyms: ["company name", "company", "business name", "business", "account name", "name"] },
  { key: "phone", label: "Phone", required: true, synonyms: ["phone number", "phone", "telephone", "main phone", "business phone", "phone 1", "mobile phone number", "mobile"] },
  { key: "contact_name", label: "Owner name (full)", synonyms: ["owner name", "owner", "business owner", "owner full name", "contact name", "contact", "full name", "decision maker"] },
  { key: "contact_first_name", label: "Owner first name", synonyms: ["owner first name", "first name", "firstname", "contact first name"] },
  { key: "contact_last_name", label: "Owner last name", synonyms: ["owner last name", "last name", "lastname", "contact last name"] },
  { key: "email", label: "Email", synonyms: ["email", "email address", "e-mail", "contact email"] },
  { key: "website", label: "Website", synonyms: ["website", "website url", "url", "domain", "company domain name", "web site"] },
  { key: "address", label: "Street address", synonyms: ["address", "street address", "street", "address 1", "address line 1", "full address"] },
  { key: "city", label: "City", synonyms: ["city", "town"] },
  { key: "state", label: "State", synonyms: ["state", "state/region", "state region", "province"] },
  { key: "category", label: "Category / industry", synonyms: ["industry", "category", "business category", "type", "niche", "main category"] },
  { key: "google_rating", label: "Google rating", synonyms: ["rating", "google rating", "stars", "average rating", "review rating"] },
  { key: "review_count", label: "Review count", synonyms: ["reviews", "review count", "number of reviews", "google reviews", "reviews count", "total reviews"] },
  { key: "google_profile_url", label: "Google profile URL", synonyms: ["google maps url", "maps url", "google profile", "google profile url", "place url", "gmb url", "google url", "maps link"] },
  { key: "import_notes", label: "Notes", synonyms: ["notes", "note", "description", "comments"] },
] as const;

export type FieldKey = (typeof LEAD_FIELDS)[number]["key"];
export const IGNORE = "" as const;
export type Mapping = Record<string, FieldKey | typeof IGNORE>; // CSV header -> field

const simplify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Best guess at which field each CSV column is. Each field is used at most once. */
export function guessMapping(headers: string[]): Mapping {
  const mapping: Mapping = {};
  const used = new Set<string>();
  for (const header of headers) {
    const h = simplify(header);
    const field = LEAD_FIELDS.find((f) => !used.has(f.key) && f.synonyms.some((s) => simplify(s) === h));
    mapping[header] = field?.key ?? IGNORE;
    if (field) used.add(field.key);
  }
  return mapping;
}

/** Problems that block an import, in plain English. */
export function mappingProblems(mapping: Mapping): string[] {
  const chosen = Object.values(mapping).filter(Boolean);
  const problems: string[] = [];
  for (const f of LEAD_FIELDS) {
    if ("required" in f && f.required && !chosen.includes(f.key)) problems.push(`Pick the column for "${f.label}".`);
    if (chosen.filter((c) => c === f.key).length > 1) problems.push(`"${f.label}" is picked for more than one column.`);
  }
  return problems;
}
