import "server-only";
import { headers } from "next/headers";

/**
 * The origin this request arrived on, for links people copy out of the site:
 * pay links, referral links, sign-in addresses. Taken per request rather than
 * from configuration, so a local test hands out localhost links and a
 * deployment hands out its own domain. A forged Host header only changes the
 * link shown back to whoever forged it.
 */
export async function siteOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const local = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  const proto = h.get("x-forwarded-proto") ?? (local ? "http" : "https");
  return `${proto}://${host}`;
}
