import "server-only";
import { cache } from "react";
import { sql } from "@/db";
import {
  BANK_SETTING_KEYS,
  EMPTY_BANK_FIELDS,
  resolveBankDetails,
  type BankDetails,
  type BankFields,
} from "./bankDetails";
import type { Locale } from "./i18n";

const ENTRIES = Object.entries(BANK_SETTING_KEYS) as [keyof BankFields, string][];

/** One read per request, shared by everything on the page that shows them. */
export const getBankFields = cache(async (): Promise<BankFields> => {
  const rows = await sql<{ key: string; value: string }[]>`
    SELECT key, value FROM app_settings WHERE key = ANY(${ENTRIES.map(([, key]) => key)})
  `;
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  const fields: BankFields = { ...EMPTY_BANK_FIELDS };
  for (const [field, key] of ENTRIES) fields[field] = byKey.get(key) ?? "";
  return fields;
});

export async function getBankDetails(locale: Locale): Promise<BankDetails | null> {
  return resolveBankDetails(await getBankFields(), locale);
}

/**
 * All nine fields in one transaction, already validated by the caller — the
 * same all-or-nothing rule as the site contact pair. No revalidation: bank
 * details render only on dynamic pages.
 */
export async function saveBankFields(values: BankFields): Promise<void> {
  await sql.begin(async (tx) => {
    for (const [field, key] of ENTRIES) {
      await tx`
        INSERT INTO app_settings (key, value, updated_at)
        VALUES (${key}, ${values[field]}, now())
        ON CONFLICT (key) DO UPDATE SET value = ${values[field]}, updated_at = now()
      `;
    }
  });
}
