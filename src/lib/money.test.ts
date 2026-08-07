import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatPrice,
  formatPriceBare,
  formatMoneyExact,
  isCurrency,
} from "./money";

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

test("invoice currency and language are chosen independently", () => {
  // Currency picks the unit; locale still picks the script. Persian digits in
  // an otherwise-English document are unreadable to the person it was made for.
  assert.equal(formatMoneyExact(35, "USD", "en", 145_000), "$0.35");
  assert.equal(formatMoneyExact(35, "USD", "fa", 145_000), "$0.35");
  assert.equal(formatMoneyExact(35, "IRT", "en", 145_000), "50,750 Toman");
  assert.equal(formatMoneyExact(35, "IRT", "fa", 145_000), "۵۰٬۷۵۰ تومان");
});

test("an invoice priced in Toman still adds up exactly", () => {
  // Same invariant formatPriceExact protects: no rounding to the nearest 100,
  // or a column of lines disagrees with its own total.
  const line = formatMoneyExact(33, "IRT", "en", 145_000);
  const three = formatMoneyExact(99, "IRT", "en", 145_000);
  assert.equal(line, "47,850 Toman");
  assert.equal(three, "143,550 Toman");
});

test("isCurrency refuses anything that is not a supported currency", () => {
  assert.equal(isCurrency("USD"), true);
  assert.equal(isCurrency("IRT"), true);
  assert.equal(isCurrency("EUR"), false);
  assert.equal(isCurrency("usd"), false);
  assert.equal(isCurrency(""), false);
});
