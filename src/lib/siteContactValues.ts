/**
 * Validation and link formatting for the business contact shown publicly.
 * Kept free of database imports so the same rules can be unit tested directly.
 */

export type SiteContact = {
  email: string;
  phone: string;
  phoneHref: string;
};

function latinDigits(value: string): string {
  return value.replace(/[۰-۹٠-٩]/g, (digit) => {
    const code = digit.charCodeAt(0);
    const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
    return String(code - base);
  });
}

/** A deliberately practical business-email subset that is safe in mailto:. */
export function normalizeContactEmail(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  if (value.length === 0 || value.length > 254 || value.includes("..")) return null;
  const parts = value.split("@");
  if (parts.length !== 2 || !/^[a-z0-9._+-]+$/.test(parts[0])) return null;
  const labels = parts[1].split(".");
  if (labels.length < 2 || labels.at(-1)!.length < 2) return null;
  return labels.every((label) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))
    ? value
    : null;
}

/**
 * Preserve readable formatting while accepting digits typed on a Persian
 * keyboard. Letters and extensions are refused because they cannot produce a
 * dependable tel: destination.
 */
export function normalizeContactPhone(raw: string): string | null {
  const value = latinDigits(raw.trim()).replace(/\s+/g, " ");
  if (!/^\+?[0-9 ().-]+$/.test(value)) return null;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 18 ? value : null;
}

export function contactPhoneHref(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return `tel:${phone.trim().startsWith("+") ? "+" : ""}${digits}`;
}
