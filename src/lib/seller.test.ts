import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { getSeller } from "./seller";

const KEYS = [
  "SELLER_NAME", "SELLER_NAME_FA", "SELLER_ADDRESS", "SELLER_ADDRESS_FA",
  "SELLER_EMAIL", "SELLER_PHONE", "SELLER_TAX_ID",
];

afterEach(() => {
  for (const k of KEYS) delete process.env[k];
});

test("Persian prefers the _FA variant when it is set", () => {
  process.env.SELLER_NAME = "TEMEX Co.";
  process.env.SELLER_NAME_FA = "پارس‌تک ساپلای";
  assert.equal(getSeller("fa").name, "پارس‌تک ساپلای");
  assert.equal(getSeller("en").name, "TEMEX Co.");
});

test("Persian falls back to the Latin value when no _FA variant is set", () => {
  // A deployment that has not translated its address should still print one.
  process.env.SELLER_NAME = "TEMEX Co.";
  assert.equal(getSeller("fa").name, "TEMEX Co.");
});

test("an unconfigured deployment prints an obviously unfinished name", () => {
  // Better an invoice that looks wrong than one that looks right and is not.
  assert.match(getSeller("en").name, /SELLER_NAME/);
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
