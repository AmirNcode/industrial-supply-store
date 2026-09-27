import { test } from "node:test";
import assert from "node:assert/strict";
import { latinDigits } from "./digits";

test("Persian and Arabic-Indic digits become ASCII; nothing else changes", () => {
  assert.equal(latinDigits("۰۱۲۳۴۵۶۷۸۹"), "0123456789");
  assert.equal(latinDigits("٠١٢٣٤٥٦٧٨٩"), "0123456789");
  assert.equal(latinDigits("Tehran ۱۴۰۵!"), "Tehran 1405!");
  assert.equal(latinDigits("abc-123"), "abc-123");
});
