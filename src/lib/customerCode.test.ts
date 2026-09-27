import { test } from "node:test";
import assert from "node:assert/strict";
import { codeFromPhone, isCustomerCode, parseLogin, randomCustomerCode } from "./customerCode";

test("the last seven digits of the phone, whatever the formatting or keyboard", () => {
  assert.equal(codeFromPhone("0912 345 6789"), "3456789");
  assert.equal(codeFromPhone("+98 912 345 6789"), "3456789");
  assert.equal(codeFromPhone("۰۹۱۲۳۴۵۶۷۸۹"), "3456789");
  assert.equal(codeFromPhone("021-8888-0012"), "8880012");
  assert.equal(codeFromPhone("09120000123"), "0000123");
});

test("a phone with fewer than seven digits has no code", () => {
  assert.equal(codeFromPhone("12345"), null);
  assert.equal(codeFromPhone(""), null);
});

test("random codes are seven digits with no leading zero", () => {
  for (let i = 0; i < 200; i++) assert.match(randomCustomerCode(), /^[1-9][0-9]{6}$/);
});

test("isCustomerCode accepts exactly seven ASCII digits", () => {
  assert.equal(isCustomerCode("3456789"), true);
  assert.equal(isCustomerCode("345678"), false);
  assert.equal(isCustomerCode("34567890"), false);
  assert.equal(isCustomerCode("۳۴۵۶۷۸۹"), false);
});

test("one sign-in field: seven digits is an ID, anything else is an email", () => {
  assert.deepEqual(parseLogin("3456789"), { kind: "code", code: "3456789" });
  assert.deepEqual(parseLogin(" ۳۴۵۶۷۸۹ "), { kind: "code", code: "3456789" });
  assert.deepEqual(parseLogin(" Sara@Example.COM "), { kind: "email", email: "sara@example.com" });
  assert.deepEqual(parseLogin("123456"), { kind: "email", email: "123456" });
  assert.equal(parseLogin("   "), null);
});
