/**
 * What each contact field is, in the words a browser understands, keyed by the
 * field's `name`. Without it a phone does not offer the saved name, email,
 * phone or address on checkout, sign-up or the account page, and the customer
 * types all of it by thumb (review R-14).
 */
export const AUTOFILL: Record<string, string> = {
  company: "organization",
  contactName: "name",
  recipient: "name",
  email: "email",
  phone: "tel",
  address: "street-address",
  city: "address-level2",
  postalCode: "postal-code",
  code: "one-time-code",
};
