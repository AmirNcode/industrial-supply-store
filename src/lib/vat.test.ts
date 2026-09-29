import { test } from "node:test";
import assert from "node:assert/strict";
import { formatVatPercent, parseVatPercent, vatPercentInput } from "./vat";

test("a VAT rate typed on either keyboard reads as basis points", () => {
  assert.equal(parseVatPercent("10"), 1000);
  assert.equal(parseVatPercent("۱۰"), 1000);
  assert.equal(parseVatPercent(" 9.5 "), 950);
  assert.equal(parseVatPercent("۹٫۵"), 950);
  assert.equal(parseVatPercent("9,25"), 925);
  assert.equal(parseVatPercent("10%"), 1000);
  assert.equal(parseVatPercent("۱۰٪"), 1000);
  assert.equal(parseVatPercent("0"), 0);
  assert.equal(parseVatPercent("100"), 10000);
});

test("a rate that is not a plain percentage is refused, not guessed", () => {
  assert.equal(parseVatPercent(""), null);
  assert.equal(parseVatPercent("ten"), null);
  assert.equal(parseVatPercent("-5"), null);
  assert.equal(parseVatPercent("9.125"), null);
  assert.equal(parseVatPercent("100.01"), null);
  assert.equal(parseVatPercent("1e2"), null);
  assert.equal(parseVatPercent("."), null);
});

test("the rate prints as a percentage in each language, and round-trips through the form", () => {
  assert.equal(formatVatPercent(1000, "en"), "10%");
  assert.equal(formatVatPercent(950, "en"), "9.5%");
  assert.equal(formatVatPercent(1000, "fa"), "۱۰٪");
  assert.equal(vatPercentInput(950), "9.5");
  assert.equal(vatPercentInput(1000), "10");
  assert.equal(parseVatPercent(vatPercentInput(925)), 925);
});
