import { test } from "node:test";
import assert from "node:assert/strict";
import { digitsBefore, groupDigits, indexAfterDigits, latinDigits } from "./digits";
import { parseRialAmount } from "./money";

test("Persian and Arabic-Indic digits become ASCII; nothing else changes", () => {
  assert.equal(latinDigits("۰۱۲۳۴۵۶۷۸۹"), "0123456789");
  assert.equal(latinDigits("٠١٢٣٤٥٦٧٨٩"), "0123456789");
  assert.equal(latinDigits("Tehran ۱۴۰۵!"), "Tehran 1405!");
  assert.equal(latinDigits("abc-123"), "abc-123");
});

test("an amount is grouped in threes from the right, whatever was typed around it", () => {
  assert.equal(groupDigits("10000000"), "10,000,000");
  assert.equal(groupDigits("1000"), "1,000");
  assert.equal(groupDigits("999"), "999");
  assert.equal(groupDigits(""), "");
  // Pasted with marks or spaces already in it: regrouped, not doubled.
  assert.equal(groupDigits("1,0000,000"), "10,000,000");
  assert.equal(groupDigits(" 25 000 "), "25,000");
  assert.equal(groupDigits("12a3b4"), "1,234");
});

test("Persian digits keep their script and take the Persian thousands mark", () => {
  assert.equal(groupDigits("۱۰۰۰۰۰۰۰"), "۱۰٬۰۰۰٬۰۰۰");
  assert.equal(groupDigits("۱۰٬۰۰۰٬۰۰۰"), "۱۰٬۰۰۰٬۰۰۰");
});

test("a grouped amount still parses to the number typed", () => {
  assert.equal(parseRialAmount(groupDigits("10000000")), 10_000_000);
  assert.equal(parseRialAmount(groupDigits("۱۰۰۰۰۰۰۰")), 10_000_000);
});

test("the caret stays after the same digit when the marks move", () => {
  // Typing the fourth digit at the end of "100": caret after digit 4.
  const next = groupDigits("1000");
  assert.equal(indexAfterDigits(next, digitsBefore("1000", 4)), next.length);
  // Caret after the "1" of "1,000" stays after it in "10,000".
  assert.equal(digitsBefore("1,000", 1), 1);
  assert.equal(indexAfterDigits("10,000", 1), 1);
  assert.equal(indexAfterDigits("10,000", 3), 4);
  assert.equal(indexAfterDigits("10,000", 0), 0);
});
