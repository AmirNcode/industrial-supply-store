import "server-only";

import { cache } from "react";
import { sql } from "@/db";
import {
  contactPhoneHref,
  normalizeContactEmail,
  normalizeContactPhone,
  type SiteContact,
} from "./siteContactValues";

const KEY_EMAIL = "site_contact_email";
const KEY_PHONE = "site_contact_phone";
const DEFAULT_EMAIL = "sales@temex.example";
const DEFAULT_PHONE = "+98 21 8888 0000";

function fallbackEmail(): string {
  return normalizeContactEmail(process.env.SELLER_EMAIL ?? "") ?? DEFAULT_EMAIL;
}

function fallbackPhone(): string {
  return normalizeContactPhone(process.env.SELLER_PHONE ?? "") ?? DEFAULT_PHONE;
}

/** One settings read per request, shared by the header and invoice when both render. */
export const getSiteContact = cache(async (): Promise<SiteContact> => {
  const rows = await sql<{ key: string; value: string }[]>`
    SELECT key, value
    FROM app_settings
    WHERE key IN (${KEY_EMAIL}, ${KEY_PHONE})
  `;
  const values = new Map(rows.map((row) => [row.key, row.value]));
  const email = normalizeContactEmail(values.get(KEY_EMAIL) ?? "") ?? fallbackEmail();
  const phone = normalizeContactPhone(values.get(KEY_PHONE) ?? "") ?? fallbackPhone();

  return { email, phone, phoneHref: contactPhoneHref(phone) };
});

/** Both public contact values change together or neither does. */
export async function saveSiteContact(email: string, phone: string): Promise<void> {
  const normalizedEmail = normalizeContactEmail(email);
  const normalizedPhone = normalizeContactPhone(phone);
  if (!normalizedEmail || !normalizedPhone) {
    throw new TypeError("Invalid site contact values");
  }

  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (${KEY_EMAIL}, ${normalizedEmail}, now())
      ON CONFLICT (key) DO UPDATE
      SET value = ${normalizedEmail}, updated_at = now()
    `;
    await tx`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (${KEY_PHONE}, ${normalizedPhone}, now())
      ON CONFLICT (key) DO UPDATE
      SET value = ${normalizedPhone}, updated_at = now()
    `;
  });
}

