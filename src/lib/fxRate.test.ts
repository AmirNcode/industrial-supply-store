import { test } from "node:test";
import assert from "node:assert/strict";
import {
  configuredFxRate,
  resolveFxRate,
  isPlausibleRate,
  parseRate,
  DEFAULT_FX_RATE,
} from "./fxRate";

const ENV = 1_100_000;

test("auto mode uses the environment rate and ignores any stored value", () => {
  assert.equal(resolveFxRate({ mode: "auto", manualRate: 999 }, ENV), ENV);
  assert.equal(resolveFxRate({ mode: "auto", manualRate: null }, ENV), ENV);
});

test("manual mode uses the stored rate", () => {
  assert.equal(resolveFxRate({ mode: "manual", manualRate: 1_185_000 }, ENV), 1_185_000);
});

test("manual mode falls back to the environment rate rather than to zero", () => {
  // A missing or corrupt setting must not price the entire catalog at nothing.
  assert.equal(resolveFxRate({ mode: "manual", manualRate: null }, ENV), ENV);
  assert.equal(resolveFxRate({ mode: "manual", manualRate: 0 }, ENV), ENV);
  assert.equal(resolveFxRate({ mode: "manual", manualRate: -5 }, ENV), ENV);
  assert.equal(resolveFxRate({ mode: "manual", manualRate: Number.NaN }, ENV), ENV);
});

test("a non-finite environment rate falls back to the built-in default", () => {
  assert.equal(resolveFxRate({ mode: "auto", manualRate: null }, Number.NaN), DEFAULT_FX_RATE);
});

test("plausible rates are within an order of magnitude of the environment rate", () => {
  assert.equal(isPlausibleRate(1_185_000, ENV), true);
  assert.equal(isPlausibleRate(ENV, ENV), true);
  assert.equal(isPlausibleRate(ENV * 10, ENV), true);
  assert.equal(isPlausibleRate(ENV / 10, ENV), true);
});

test("a fat-fingered rate is rejected", () => {
  // 11,850,000 is 1,185,000 with one extra zero — the exact slip this guards.
  assert.equal(isPlausibleRate(11_850_000, ENV), false);
  assert.equal(isPlausibleRate(11, ENV), false);
  assert.equal(isPlausibleRate(0, ENV), false);
  assert.equal(isPlausibleRate(-1_185_000, ENV), false);
});

test("parseRate accepts whole numbers and rejects everything else", () => {
  assert.equal(parseRate("1185000"), 1_185_000);
  assert.equal(parseRate(" 1185000 "), 1_185_000);
  assert.equal(parseRate("1,185,000"), 1_185_000);
  assert.equal(parseRate("1185000.4"), null);
  assert.equal(parseRate("abc"), null);
  assert.equal(parseRate(""), null);
});

test("parseRate accepts Persian and Arabic-Indic digits", () => {
  // The admin panel runs in Persian, so a Persian keyboard produces these by
  // default. Number() reads them as NaN, so a correctly typed rate was being
  // rejected as unparseable.
  assert.equal(parseRate("۱۱۸۵۰۰۰"), 1_185_000);
  assert.equal(parseRate("١١٨٥٠٠٠"), 1_185_000);
  assert.equal(parseRate("۱٬۱۸۵٬۰۰۰"), 1_185_000);
  assert.equal(parseRate("۱,۱۸۵,۰۰۰"), 1_185_000);
});

test("the Rial environment setting wins, with a converted legacy fallback", () => {
  assert.equal(configuredFxRate("1250000", "120000"), 1_250_000);
  assert.equal(configuredFxRate(undefined, "120000"), 1_200_000);
  assert.equal(configuredFxRate("bad", "120000"), 1_200_000);
  assert.equal(configuredFxRate(undefined, undefined), DEFAULT_FX_RATE);
});
