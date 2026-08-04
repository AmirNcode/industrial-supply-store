import { test } from "node:test";
import assert from "node:assert/strict";
import { safeLocale } from "./i18n";

function fd(value: string | null): FormData {
  const f = new FormData();
  if (value !== null) f.set("locale", value);
  return f;
}

test("a known locale passes through", () => {
  assert.equal(safeLocale(fd("en")), "en");
  assert.equal(safeLocale(fd("fa")), "fa");
});

test("a missing locale falls back to English", () => {
  assert.equal(safeLocale(fd(null)), "en");
  assert.equal(safeLocale(fd("")), "en");
});

test("a value that would escape the site is refused", () => {
  // "/evil.com" would make redirect(`/${locale}/admin`) produce
  // "//evil.com/admin" — a protocol-relative URL, and an open redirect.
  assert.equal(safeLocale(fd("/evil.com")), "en");
  assert.equal(safeLocale(fd("//evil.com")), "en");
  assert.equal(safeLocale(fd("https://evil.com")), "en");
  assert.equal(safeLocale(fd("../../etc")), "en");
});

test("an unknown but harmless locale still falls back", () => {
  assert.equal(safeLocale(fd("de")), "en");
});
