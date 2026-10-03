import { listForTimezone, locate, normalizePhone, normalizeState } from "@/lib/phone";
import type { FieldKey } from "./fields";

export type MappedRow = Partial<Record<FieldKey, string>>;

/** What the database import function receives for one row. */
export type CleanRow = {
  business_name: string;
  contact_name: string | null;
  phone_raw: string | null;
  phone_e164: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  category: string | null;
  google_rating: number | null;
  review_count: number | null;
  google_profile_url: string | null;
  import_notes: string | null;
  timezone: string | null;
  list: "EAST" | "WEST" | null;
  invalid_reason?: string;
};

const text = (v: string | undefined) => {
  const t = (v ?? "").replace(/\s+/g, " ").trim();
  return t === "" ? null : t;
};

function rating(v: string | undefined): number | null {
  const n = Number.parseFloat((v ?? "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 && n <= 5 ? Math.round(n * 10) / 10 : null;
}

function count(v: string | undefined): number | null {
  const n = Number.parseInt((v ?? "").replace(/[,\s]/g, ""), 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function cleanRow(m: MappedRow): CleanRow {
  const contact =
    text(m.contact_name) ?? text([m.contact_first_name, m.contact_last_name].filter(Boolean).join(" "));
  const phoneRaw = text(m.phone);
  const phone = normalizePhone(phoneRaw);
  const where = phone ? locate(phone, m.state) : { state: normalizeState(m.state), timezone: null };

  const row: CleanRow = {
    business_name: text(m.business_name) ?? "",
    contact_name: contact,
    phone_raw: phoneRaw,
    phone_e164: phone,
    email: text(m.email)?.toLowerCase() ?? null,
    website: text(m.website),
    address: text(m.address),
    city: text(m.city),
    state: where.state,
    category: text(m.category),
    google_rating: rating(m.google_rating),
    review_count: count(m.review_count),
    google_profile_url: text(m.google_profile_url),
    import_notes: text(m.import_notes),
    timezone: where.timezone,
    list: listForTimezone(where.timezone),
  };

  if (!row.business_name) row.invalid_reason = "No business name";
  else if (!phoneRaw) row.invalid_reason = "No phone number";
  else if (!phone) row.invalid_reason = "Not a valid US phone number";

  return row;
}
