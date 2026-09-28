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
    address: "",
    city: "",
    country: "",
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

test("company, contact and phone are always required", () => {
  for (const name of ["company", "contactName", "phone"]) {
    assert.deepEqual(parseContact(form({ [name]: "  " }), false), { error: "missing" }, name);
  }
});

test("optional fields are trimmed, and an over-long one is refused rather than cut", () => {
  const ok = parseContact(form({ city: "  تهران  ", notes: "Deliver after 10" }), false);
  assert.ok("contact" in ok);
  assert.equal(ok.contact.city, "تهران");
  assert.equal(ok.contact.notes, "Deliver after 10");
  assert.deepEqual(parseContact(form({ notes: "x".repeat(10_000) }), false), { error: "invalid" });
});
