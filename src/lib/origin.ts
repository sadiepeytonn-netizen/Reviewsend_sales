import "server-only";
import { headers } from "next/headers";

/** This site's public address (e.g. https://sales.reviewsend.io), for links Twilio calls back. */
export async function appOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}
