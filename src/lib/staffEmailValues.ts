import { normalizeContactEmail } from "./siteContactValues";

/**
 * Each address gets its own copy of every staff alert, and every copy counts
 * against the Resend plan's daily cap (100 on the free plan), so the list is
 * kept short.
 */
export const STAFF_EMAIL_LIMIT = 10;

/** The stored JSON array, read defensively: anything malformed is skipped, never thrown. */
export function parseStaffEmailList(stored: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: string[] = [];
  for (const item of parsed) {
    const email = typeof item === "string" ? normalizeContactEmail(item) : null;
    if (email && !out.includes(email)) out.push(email);
  }
  return out.slice(0, STAFF_EMAIL_LIMIT);
}
