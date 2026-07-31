import { test } from "node:test";
import assert from "node:assert/strict";
import { formatPrice, formatPriceBare } from "./money";

const RATE = 110000;

test("English prices are dollars and ignore the rate", () => {
  assert.equal(formatPrice(35, "en", RATE), "$0.35");
  assert.equal(formatPrice(35, "en", 999999), "$0.35");
  assert.equal(formatPriceBare(35, "en", RATE), "0.35");
});

test("Persian prices convert at the rate supplied, not a global one", () => {
  // 35 cents at 110000 = 38500 Toman; at 220000 = 77000.
  assert.match(formatPrice(35, "fa", 110000), /۳۸٬۵۰۰/);
  assert.match(formatPrice(35, "fa", 220000), /۷۷٬۰۰۰/);
});

test("Toman amounts round to the nearest hundred", () => {
  // 37 cents at 110000 = 40700 exactly; 36 cents = 39600.
  assert.match(formatPrice(37, "fa", 110000), /۴۰٬۷۰۰/);
});

test("a zero price formats rather than throwing", () => {
  assert.equal(formatPrice(0, "en", RATE), "$0.00");
  assert.match(formatPrice(0, "fa", RATE), /۰/);
});
