import "server-only";
import type { Locale } from "./i18n";
import { PLACEHOLDER_CONTACT_EMAIL, PLACEHOLDER_CONTACT_PHONE } from "./siteContactValues";

/**
 * Who the invoice is from.
 *
 * The name is TEMEX, in both languages — the owner's decision, so it is not a
 * setting. Address and tax ID stay in deployment configuration. Email and
 * phone are only fallbacks: the invoice prints the site-contact values saved
 * in Admin → Settings, and these apply only until they are.
 */
export type Seller = {
  name: string;
  addressLines: string[];
  email: string;
  phone: string;
  /** Printed only when set — not every jurisdiction requires one. */
  taxId: string;
};

export function getSeller(locale: Locale): Seller {
  const suffix = locale === "fa" ? "_FA" : "";
  // An empty value counts as unset, not as an answer. `.env.example` ships
  // `SELLER_TAX_ID=` and so teaches the blank-assignment habit; a Persian
  // variant blanked the same way would otherwise print an empty address
  // instead of falling back to the Latin one.
  const pick = (key: string, fallback: string) => {
    const candidates = [process.env[`SELLER_${key}${suffix}`], process.env[`SELLER_${key}`]];
    for (const c of candidates) if (c !== undefined && c.trim() !== "") return c;
    return fallback;
  };

  return {
    name: "TEMEX",
    addressLines: pick("ADDRESS", "")
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean),
    email: pick("EMAIL", PLACEHOLDER_CONTACT_EMAIL),
    phone: pick("PHONE", PLACEHOLDER_CONTACT_PHONE),
    taxId: pick("TAX_ID", ""),
  };
}
