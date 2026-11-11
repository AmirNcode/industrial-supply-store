import { test } from "node:test";
import assert from "node:assert/strict";
import { parseContact } from "./quoteContact";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  const base = {
    company: "Acme",
    contactName: "Sara",
    email: "",
    phone: "0912 000 0000",
    poNumber: "",
    address: "Unit 4, Industrial Rd",
    city: "Tehran",
    postalCode: "",
    nationalId: "",
    economicCode: "",
    notes: "",
  };
  for (const [name, value] of Object.entries({ ...base, ...values })) data.set(name, value);
  return data;
}

test("a guest must give an email; a signed-in buyer or a rep's customer need not", () => {
  assert.deepEqual(parseContact(form({}), true), { error: "missing" });
  const signedIn = parseContact(form({}), false);
  assert.ok("contact" in signedIn);
  assert.equal(signedIn.contact.email, "");
});

test("an email that is given must look like one, and is stored lower-case", () => {
  assert.deepEqual(parseContact(form({ email: "not-an-email" }), false), { error: "invalid" });
  const ok = parseContact(form({ email: "Buyer@Example.COM" }), true);
  assert.ok("contact" in ok);
  assert.equal(ok.contact.email, "buyer@example.com");
});

test("company, contact, phone, address and city are always required", () => {
  for (const name of ["company", "contactName", "phone", "address", "city"]) {
    assert.deepEqual(parseContact(form({ [name]: "  " }), false), { error: "missing" }, name);
  }
});

test("country is no longer asked: it is stored blank whatever is posted", () => {
  const ok = parseContact(form({ country: "Iran" }), false);
  assert.ok("contact" in ok);
  assert.equal(ok.contact.country, "");
});

test("optional fields are trimmed, and an over-long one is refused rather than cut", () => {
  const ok = parseContact(form({ city: "  تهران  ", notes: "Deliver after 10" }), false);
  assert.ok("contact" in ok);
  assert.equal(ok.contact.city, "تهران");
  assert.equal(ok.contact.notes, "Deliver after 10");
  assert.deepEqual(parseContact(form({ notes: "x".repeat(10_000) }), false), { error: "invalid" });
});

test("postal code, national ID and economic code are digits only, Persian digits accepted", () => {
  const ok = parseContact(
    form({ postalCode: "۱۲۳۴۵-۶۷۸۹۰", nationalId: "0012 345 678", economicCode: "۴۱۱۱۲۲۳۳۴۴۵۵" }),
    false,
  );
  assert.ok("contact" in ok);
  assert.equal(ok.contact.postalCode, "1234567890");
  assert.equal(ok.contact.nationalId, "0012345678");
  assert.equal(ok.contact.economicCode, "411122334455");
  // Empty is fine: they are optional.
  const blank = parseContact(form({}), false);
  assert.ok("contact" in blank);
  assert.equal(blank.contact.postalCode, "");
  assert.equal(blank.contact.nationalId, "");
  assert.equal(blank.contact.economicCode, "");
});

test("letters or too many digits in a tax or postal field are refused, not cut", () => {
  for (const name of ["postalCode", "nationalId", "economicCode"]) {
    assert.deepEqual(parseContact(form({ [name]: "12ab34" }), false), { error: "invalid" }, `${name} letters`);
    assert.deepEqual(parseContact(form({ [name]: "1".repeat(40) }), false), { error: "invalid" }, `${name} long`);
  }
});
