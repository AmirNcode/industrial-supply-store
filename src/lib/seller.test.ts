import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { getSeller } from "./seller";

const KEYS = [
  "SELLER_NAME", "SELLER_ADDRESS", "SELLER_ADDRESS_FA",
  "SELLER_EMAIL", "SELLER_PHONE", "SELLER_TAX_ID",
];

afterEach(() => {
  for (const k of KEYS) delete process.env[k];
});

test("the seller is TEMEX in both languages, whatever the environment says", () => {
  process.env.SELLER_NAME = "Something Else Co.";
  assert.equal(getSeller("en").name, "TEMEX");
  assert.equal(getSeller("fa").name, "TEMEX");
});

test("Persian prefers the _FA variant when it is set", () => {
  process.env.SELLER_ADDRESS = "Unit 4, Sanat Street";
  process.env.SELLER_ADDRESS_FA = "خیابان صنعت، واحد ۴";
  assert.deepEqual(getSeller("fa").addressLines, ["خیابان صنعت، واحد ۴"]);
  assert.deepEqual(getSeller("en").addressLines, ["Unit 4, Sanat Street"]);
});

test("Persian falls back to the Latin value when no _FA variant is set", () => {
  // A deployment that has not translated its address should still print one.
  process.env.SELLER_ADDRESS = "Unit 4, Sanat Street";
  assert.deepEqual(getSeller("fa").addressLines, ["Unit 4, Sanat Street"]);
});

test("the address splits on pipes", () => {
  process.env.SELLER_ADDRESS = "Unit 4, Sanat Street|Tehran 1234567|Iran";
  assert.deepEqual(getSeller("en").addressLines, [
    "Unit 4, Sanat Street",
    "Tehran 1234567",
    "Iran",
  ]);
});

test("empty, trailing and whitespace-only address segments do not become blank lines", () => {
  process.env.SELLER_ADDRESS = "Unit 4|   |Tehran|";
  assert.deepEqual(getSeller("en").addressLines, ["Unit 4", "Tehran"]);
});

test("an unset address is no lines rather than one empty line", () => {
  assert.deepEqual(getSeller("en").addressLines, []);
});

test("the tax id stays empty when unset, so the invoice can omit the row", () => {
  assert.equal(getSeller("en").taxId, "");
  process.env.SELLER_TAX_ID = "IR-123456";
  assert.equal(getSeller("en").taxId, "IR-123456");
});
