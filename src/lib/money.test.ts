import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PRICE_DISPLAY_MODE,
  customerCurrencyFor,
  formatMoneyExact,
  formatPrice,
  formatPriceBare,
  invoiceCurrencyFor,
  isCurrency,
  isPriceDisplayMode,
} from "./money";

const RATE = 1_100_000;

test("Rial-only is the safe default customer display mode", () => {
  assert.equal(DEFAULT_PRICE_DISPLAY_MODE, "irr");
  assert.equal(isPriceDisplayMode("usd"), true);
  assert.equal(isPriceDisplayMode("irr"), true);
  assert.equal(isPriceDisplayMode("both"), true);
  assert.equal(isPriceDisplayMode("IRT"), false);
});

test("customer currency follows the admin mode, then language only in both mode", () => {
  assert.equal(customerCurrencyFor("usd", "en"), "USD");
  assert.equal(customerCurrencyFor("usd", "fa"), "USD");
  assert.equal(customerCurrencyFor("irr", "en"), "IRR");
  assert.equal(customerCurrencyFor("irr", "fa"), "IRR");
  assert.equal(customerCurrencyFor("both", "en"), "USD");
  assert.equal(customerCurrencyFor("both", "fa"), "IRR");
});

test("invoice requests are honoured only when both currencies are enabled", () => {
  assert.equal(invoiceCurrencyFor("both", "fa", "usd"), "USD");
  assert.equal(invoiceCurrencyFor("both", "en", "IRR"), "IRR");
  assert.equal(invoiceCurrencyFor("both", "fa", "EUR"), "IRR");
  assert.equal(invoiceCurrencyFor("usd", "fa", "IRR"), "USD");
  assert.equal(invoiceCurrencyFor("irr", "en", "USD"), "IRR");
});

test("USD prices ignore the Rial rate in either language", () => {
  assert.equal(formatPrice(35, "USD", "en", RATE), "$0.35");
  assert.equal(formatPrice(35, "USD", "fa", 9_999_999), "$0.35");
  assert.equal(formatPriceBare(35, "USD", "fa", RATE), "0.35");
});

test("Rial prices use the supplied rate and locale-appropriate digits", () => {
  assert.equal(formatPrice(35, "IRR", "en", RATE), "385,000 IRR");
  assert.equal(formatPrice(35, "IRR", "fa", RATE), "۳۸۵٬۰۰۰ ریال");
  assert.equal(formatPriceBare(35, "IRR", "en", RATE), "385,000");
});

test("catalog Rial amounts round to the nearest thousand", () => {
  assert.equal(formatPrice(36, "IRR", "en", 1_101_000), "396,000 IRR");
  assert.equal(formatPrice(37, "IRR", "en", RATE), "407,000 IRR");
});

test("a zero price formats rather than throwing", () => {
  assert.equal(formatPrice(0, "USD", "en", RATE), "$0.00");
  assert.equal(formatPrice(0, "IRR", "fa", RATE), "۰ ریال");
});

test("invoice currency and language are independent", () => {
  assert.equal(formatMoneyExact(35, "USD", "en", 1_450_000), "$0.35");
  assert.equal(formatMoneyExact(35, "USD", "fa", 1_450_000), "$0.35");
  assert.equal(formatMoneyExact(35, "IRR", "en", 1_450_000), "507,500 IRR");
  assert.equal(formatMoneyExact(35, "IRR", "fa", 1_450_000), "۵۰۷٬۵۰۰ ریال");
});

test("an invoice priced in Rial keeps whole-Rial precision", () => {
  const line = formatMoneyExact(33, "IRR", "en", 1_450_000);
  const three = formatMoneyExact(99, "IRR", "en", 1_450_000);
  assert.equal(line, "478,500 IRR");
  assert.equal(three, "1,435,500 IRR");
});

test("isCurrency accepts ISO USD and IRR only", () => {
  assert.equal(isCurrency("USD"), true);
  assert.equal(isCurrency("IRR"), true);
  assert.equal(isCurrency("IRT"), false);
  assert.equal(isCurrency("usd"), false);
  assert.equal(isCurrency(""), false);
});
