import { test } from "node:test";
import assert from "node:assert/strict";
import {
  contactPhoneHref,
  normalizeContactEmail,
  normalizeContactPhone,
} from "./siteContactValues";

test("contact email is trimmed and normalized for display and mailto", () => {
  assert.equal(normalizeContactEmail("  SALES@TEMEX.EXAMPLE  "), "sales@temex.example");
});

test("contact email refuses missing domains and mailto query injection", () => {
  assert.equal(normalizeContactEmail("sales@temex"), null);
  assert.equal(normalizeContactEmail("sales@temex.example?bcc=other@example.com"), null);
});

test("contact phone accepts common formatting and Persian digits", () => {
  assert.equal(normalizeContactPhone("+۹۸ ۲۱ ۸۸۸۸ ۰۰۰۰"), "+98 21 8888 0000");
  assert.equal(normalizeContactPhone("(021) 8888-0000"), "(021) 8888-0000");
});

test("contact phone refuses letters and implausibly short values", () => {
  assert.equal(normalizeContactPhone("call sales"), null);
  assert.equal(normalizeContactPhone("123"), null);
});

test("phone links keep a leading plus and remove display punctuation", () => {
  assert.equal(contactPhoneHref("+98 (21) 8888-0000"), "tel:+982188880000");
  assert.equal(contactPhoneHref("021 8888 0000"), "tel:02188880000");
});

