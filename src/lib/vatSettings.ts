import "server-only";

import { cache } from "react";
import { getSmallSettings } from "./appSettings";
import { sql } from "@/db";
import { MAX_VAT_RATE_BP } from "./vat";

const KEY_VAT_RATE = "vat_rate_bp";

/**
 * The VAT rate the next invoice will carry, in basis points. Unset reads as
 * 0: until the admin enters a rate, invoices are issued exactly as before, with
 * a zero VAT line. An invoice already issued reads its own locked rate from
 * `orders.vat_rate_bp`, never this.
 */
export const getVatRateBp = cache(async (): Promise<number> => {
  const bp = Number((await getSmallSettings()).get(KEY_VAT_RATE));
  return Number.isInteger(bp) && bp >= 0 && bp <= MAX_VAT_RATE_BP ? bp : 0;
});

export async function saveVatRateBp(bp: number): Promise<void> {
  if (!Number.isInteger(bp) || bp < 0 || bp > MAX_VAT_RATE_BP) {
    throw new RangeError("Invalid VAT rate");
  }
  await sql`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (${KEY_VAT_RATE}, ${String(bp)}, now())
    ON CONFLICT (key) DO UPDATE SET value = ${String(bp)}, updated_at = now()
  `;
}
