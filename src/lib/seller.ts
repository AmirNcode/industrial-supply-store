import "server-only";
import type { Locale } from "./i18n";

/**
 * Who the invoice is from.
 *
 * Legal identity, address and tax ID stay in deployment configuration. Email
 * and phone are also the deployment fallbacks, but the invoice page overlays
 * the administrator's site-contact settings when they have been saved. The
 * defaults are deliberately obviously-placeholder, so an unconfigured
 * deployment produces an invoice that looks unfinished instead of one that
 * looks real and is wrong.
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
  // `SELLER_TAX_ID=` and so teaches the blank-assignment habit; a deployment
  // that blanks SELLER_NAME= the same way would otherwise get an empty seller
  // name instead of the loud placeholder, which is the only thing standing
  // between an unconfigured install and an emailed invoice that looks real.
  const pick = (key: string, fallback: string) => {
    const candidates = [process.env[`SELLER_${key}${suffix}`], process.env[`SELLER_${key}`]];
    for (const c of candidates) if (c !== undefined && c.trim() !== "") return c;
    return fallback;
  };

  return {
    name: pick("NAME", "TEMEX — set SELLER_NAME"),
    addressLines: pick("ADDRESS", "")
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean),
    email: pick("EMAIL", "sales@temex.example"),
    phone: pick("PHONE", "+98 21 8888 0000"),
    taxId: pick("TAX_ID", ""),
  };
}
