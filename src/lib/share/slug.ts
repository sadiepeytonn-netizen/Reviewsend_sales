/**
 * Rep link names for screen sharing: reviewsend.io/<name>. These are taken by the website's own
 * pages (and the CRM's join page), so no rep can have them.
 */
export const RESERVED_SLUGS = new Set([
  "features", "how-it-works", "pricing", "get-started", "privacy-policy", "terms-of-service",
  "sms-consent", "sms-opt-out", "index", "robots", "sitemap", "llms", "api", "join", "login",
  "admin", "app", "www", "help", "support", "blog", "about", "contact",
]);

/** "Corban Arana" → "corban" (a starting suggestion). */
export function suggestSlug(fullName: string): string {
  return (fullName.trim().split(/\s+/)[0] ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 30);
}

/** Cleans what the admin typed; returns an error message if it can't be used. */
export function checkSlug(raw: string): { slug?: string; error?: string } {
  const slug = raw.trim().toLowerCase().replace(/^\/+/, "").replace(/\s+/g, "-");
  if (!slug) return { slug: undefined };
  if (!/^[a-z0-9][a-z0-9-]{1,29}$/.test(slug)) return { error: "Use 2–30 lowercase letters, numbers or dashes (like corban)." };
  if (RESERVED_SLUGS.has(slug)) return { error: `"${slug}" is a page on the website. Pick another name.` };
  return { slug };
}

/** The address prospects open. */
export const shareLink = (slug: string) => `reviewsend.io/${slug}`;
