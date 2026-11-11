import "server-only";

import { sql } from "@/db";
import { normalizeContactEmail } from "./siteContactValues";
import { STAFF_EMAIL_LIMIT, parseStaffEmailList } from "./staffEmailValues";

/**
 * Who is told about each new order and quote request: a list kept in Admin →
 * Settings, stored as a JSON array in `app_settings` — a setting, not a table,
 * so it needs no migration. Personal inboxes (Gmail and the like) are fine:
 * these addresses only receive mail, the site never sends *from* them.
 */
const KEY = "staff_notify_emails";

export async function getStaffEmails(): Promise<string[]> {
  const [row] = await sql<{ value: string }[]>`SELECT value FROM app_settings WHERE key = ${KEY}`;
  return row ? parseStaffEmailList(row.value) : [];
}

export type AddStaffEmailResult = "added" | "invalid" | "exists" | "full";

/** The write is one statement, so two admins adding at once cannot drop each other's address. */
export async function addStaffEmail(raw: string): Promise<AddStaffEmailResult> {
  const email = normalizeContactEmail(raw);
  if (!email) return "invalid";
  const current = await getStaffEmails();
  if (current.includes(email)) return "exists";
  if (current.length >= STAFF_EMAIL_LIMIT) return "full";
  await sql`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (${KEY}, ${JSON.stringify([email])}, now())
    ON CONFLICT (key) DO UPDATE
    SET value = CASE
          WHEN app_settings.value::jsonb ? ${email} THEN app_settings.value
          ELSE (app_settings.value::jsonb || to_jsonb(${email}::text))::text
        END,
        updated_at = now()
  `;
  return "added";
}

export async function removeStaffEmail(email: string): Promise<void> {
  await sql`
    UPDATE app_settings
    SET value = (value::jsonb - ${email.trim().toLowerCase()}::text)::text, updated_at = now()
    WHERE key = ${KEY}
  `;
}
