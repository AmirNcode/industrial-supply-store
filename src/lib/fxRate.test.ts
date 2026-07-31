import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveFxRate,
  isPlausibleRate,
  parseRate,
  DEFAULT_FX_RATE,
} from "./fxRate";

const ENV = 110000;

test("auto mode uses the environment rate and ignores any stored value", () => {
  assert.equal(resolveFxRate({ mode: "auto", manualRate: 999 }, ENV), ENV);
  assert.equal(resolveFxRate({ mode: "auto", manualRate: null }, ENV), ENV);
});

test("manual mode uses the stored rate", () => {
  assert.equal(resolveFxRate({ mode: "manual", manualRate: 118500 }, ENV), 118500);
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
  assert.equal(isPlausibleRate(118500, ENV), true);
  assert.equal(isPlausibleRate(ENV, ENV), true);
  assert.equal(isPlausibleRate(ENV * 10, ENV), true);
  assert.equal(isPlausibleRate(ENV / 10, ENV), true);
});

test("a fat-fingered rate is rejected", () => {
  // 1185000 is 118500 with one extra zero — the exact slip this guards.
  assert.equal(isPlausibleRate(1185000, ENV), false);
  assert.equal(isPlausibleRate(11, ENV), false);
  assert.equal(isPlausibleRate(0, ENV), false);
  assert.equal(isPlausibleRate(-118500, ENV), false);
});

test("parseRate accepts whole numbers and rejects everything else", () => {
  assert.equal(parseRate("118500"), 118500);
  assert.equal(parseRate(" 118500 "), 118500);
  assert.equal(parseRate("118,500"), 118500);
  assert.equal(parseRate("118500.4"), null);
  assert.equal(parseRate("abc"), null);
  assert.equal(parseRate(""), null);
});
