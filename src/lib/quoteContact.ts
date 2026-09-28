import { REQUEST_LIMITS, boundedString } from "./requestLimits";
import type { QuoteContact } from "@/db/orderSubmissionQueries";

export type ContactResult = { contact: QuoteContact } | { error: "missing" | "invalid" };

/**
 * The checkout's contact block. Email is required only from a guest — it is
 * how they track the order. A signed-in customer's order sits on their
 * account, and a rep's customer may have no email at all.
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
  const optional = (name: string, maxChars: number) =>
    boundedString(formData.get(name), maxChars, { allowEmpty: true });
  const poNumber = optional("poNumber", REQUEST_LIMITS.poNumberChars);
  const address = optional("address", REQUEST_LIMITS.addressChars);
  const city = optional("city", REQUEST_LIMITS.cityChars);
  const country = optional("country", REQUEST_LIMITS.countryChars);
  const notes = optional("notes", REQUEST_LIMITS.notesChars);
  if (poNumber === null || address === null || city === null || country === null || notes === null) {
    return { error: "invalid" };
  }
  return {
    contact: {
      company,
      contactName,
      email: normalizedEmail,
      phone,
      poNumber,
      address,
      city,
      country,
      notes,
    },
  };
}
