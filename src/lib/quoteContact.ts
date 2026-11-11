import { REQUEST_LIMITS, boundedString } from "./requestLimits";
import type { QuoteContact } from "@/db/orderSubmissionQueries";
import { latinDigits } from "./digits";

export type ContactResult = { contact: QuoteContact } | { error: "missing" | "invalid" };

/**
 * A national ID, economic code or postal code: digits only, in either
 * script, with the spaces and dashes people type between groups dropped.
 * Empty is allowed — they are optional everywhere. Null means "not that".
 */
export function digitsField(value: FormDataEntryValue | null, maxChars: number): string | null {
  const raw = boundedString(value, maxChars * 2, { allowEmpty: true });
  if (raw === null) return null;
  const digits = latinDigits(raw).replace(/[\s-]/g, "");
  return /^[0-9]*$/.test(digits) && digits.length <= maxChars ? digits : null;
}

export type DeliveryAddress = { address: string; city: string; postalCode: string };

/** The delivery block alone: address and city are required, postal code is not. */
export function parseDelivery(formData: FormData): DeliveryAddress | { error: "missing" | "invalid" } {
  const address = boundedString(formData.get("address"), REQUEST_LIMITS.addressChars, { allowEmpty: true });
  const city = boundedString(formData.get("city"), REQUEST_LIMITS.cityChars, { allowEmpty: true });
  const postalCode = digitsField(formData.get("postalCode"), REQUEST_LIMITS.postalCodeChars);
  if (address === null || city === null || postalCode === null) return { error: "invalid" };
  if (address === "" || city === "") return { error: "missing" };
  return { address, city, postalCode };
}

/**
 * The checkout's contact block. Company, name, phone, address and city are
 * always required: an order now produces a pish-factor at once, and one with
 * nowhere to deliver to cannot be fulfilled without a phone call — the wait
 * instant checkout exists to remove. Email is required from a guest (it is
 * where the pish-factor goes, and what their account is made from); a
 * signed-in customer's order uses the account's, and a rep's customer may
 * have none at all. Country is no longer asked: the column stays and is
 * stored blank.
 *
 * Its own module, not a helper inside the Server Action file, so the rules are
 * unit-tested: a "use server" file may export only actions.
 */
export function parseContact(formData: FormData, emailRequired: boolean): ContactResult {
  const company = boundedString(formData.get("company"), REQUEST_LIMITS.companyChars);
  const contactName = boundedString(formData.get("contactName"), REQUEST_LIMITS.contactNameChars);
  const phone = boundedString(formData.get("phone"), REQUEST_LIMITS.phoneChars);
  const email = boundedString(formData.get("email"), REQUEST_LIMITS.emailChars, { allowEmpty: true });
  if (email === null) return { error: "invalid" };
  if (!company || !contactName || !phone || (emailRequired && email === "")) {
    return { error: "missing" };
  }
  const normalizedEmail = email.toLowerCase();
  if (normalizedEmail !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return { error: "invalid" };
  }
  const delivery = parseDelivery(formData);
  if ("error" in delivery) return delivery;
  const optional = (name: string, maxChars: number) =>
    boundedString(formData.get(name), maxChars, { allowEmpty: true });
  const poNumber = optional("poNumber", REQUEST_LIMITS.poNumberChars);
  const notes = optional("notes", REQUEST_LIMITS.notesChars);
  const nationalId = digitsField(formData.get("nationalId"), REQUEST_LIMITS.taxIdChars);
  const economicCode = digitsField(formData.get("economicCode"), REQUEST_LIMITS.taxIdChars);
  if (poNumber === null || notes === null || nationalId === null || economicCode === null) {
    return { error: "invalid" };
  }
  return {
    contact: {
      company,
      contactName,
      email: normalizedEmail,
      phone,
      poNumber,
      address: delivery.address,
      city: delivery.city,
      country: "",
      notes,
      postalCode: delivery.postalCode,
      nationalId,
      economicCode,
    },
  };
}
