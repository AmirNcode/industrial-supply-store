import type { Locale } from "./i18n";

/**
 * Who the invoice is from.
 *
 * Environment rather than a database table: this changes when the company
 * moves office, not when a user clicks something, and putting it behind an
 * admin form would be a settings screen nobody opens twice. The defaults are
 * deliberately obviously-placeholder, so an unconfigured deployment produces
 * an invoice that looks unfinished instead of one that looks real and is wrong.
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
  const pick = (key: string, fallback: string) =>
    process.env[`SELLER_${key}${suffix}`] ?? process.env[`SELLER_${key}`] ?? fallback;

  return {
    name: pick("NAME", "Parstech Supply — set SELLER_NAME"),
    addressLines: pick("ADDRESS", "")
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean),
    email: pick("EMAIL", "sales@parstech.example"),
    phone: pick("PHONE", "+98 21 8888 0000"),
    taxId: pick("TAX_ID", ""),
  };
}
