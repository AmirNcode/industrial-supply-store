import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_BANK_FIELDS,
  groupInFours,
  isValidCard,
  isValidSheba,
  normalizeCard,
  normalizeSheba,
  resolveBankDetails,
  validateBankFields,
} from "./bankDetails";

test("a card number is sixteen digits passing the Luhn check, typed any way", () => {
  assert.equal(isValidCard("6037991234567893"), true);
  assert.equal(isValidCard("6037991234567894"), false);
  assert.equal(isValidCard("603799123456789"), false);
  assert.equal(normalizeCard("۶۰۳۷-۹۹۱۲-۳۴۵۶-۷۸۹۳"), "6037991234567893");
  assert.equal(normalizeCard("6037 9912 3456 7893"), "6037991234567893");
});

test("a Sheba number is IR and 24 digits passing the mod-97 check", () => {
  assert.equal(isValidSheba("IR820540102680020817909002"), true);
  assert.equal(isValidSheba("IR062960000000100324200001"), true);
  assert.equal(isValidSheba("IR820540102680020817909003"), false);
  assert.equal(normalizeSheba("ir82 0540 1026 8002 0817 9090 02"), "IR820540102680020817909002");
  assert.equal(normalizeSheba("820540102680020817909002"), "IR820540102680020817909002");
  assert.equal(normalizeSheba("۸۲۰۵۴۰۱۰۲۶۸۰۰۲۰۸۱۷۹۰۹۰۰۲"), "IR820540102680020817909002");
});

test("every field is optional, and one bad number refuses the whole save", () => {
  assert.deepEqual(validateBankFields(EMPTY_BANK_FIELDS), { ok: true, values: EMPTY_BANK_FIELDS });
  const typed = {
    ...EMPTY_BANK_FIELDS,
    nameFa: " بانک ملت ",
    card: "6037 9912 3456 7893",
    sheba: "IR82 0540 1026 8002 0817 9090 02",
    account: "0102-0304-05",
  };
  const ok = validateBankFields(typed);
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.values.nameFa, "بانک ملت");
    assert.equal(ok.values.card, "6037991234567893");
    assert.equal(ok.values.sheba, "IR820540102680020817909002");
    assert.equal(ok.values.account, "0102-0304-05");
  }
  assert.deepEqual(validateBankFields({ ...typed, card: "6037991234567894", account: "12" }), {
    ok: false,
    problems: ["card", "account"],
  });
  assert.deepEqual(validateBankFields({ ...typed, noteEn: "x".repeat(1001) }), {
    ok: false,
    problems: ["length"],
  });
});

test("each language falls back to the other, and an empty section is nothing at all", () => {
  const values = { ...EMPTY_BANK_FIELDS, nameEn: "Bank Mellat", holderFa: "شرکت تمکس", card: "6037991234567893" };
  assert.deepEqual(resolveBankDetails(values, "fa"), {
    name: "Bank Mellat", holder: "شرکت تمکس", card: "6037991234567893", sheba: "", account: "", note: "",
  });
  assert.equal(resolveBankDetails(values, "en")?.holder, "شرکت تمکس");
  assert.equal(resolveBankDetails(EMPTY_BANK_FIELDS, "fa"), null);
});

test("numbers are grouped in fours for reading only", () => {
  assert.equal(groupInFours("6037991234567893"), "6037 9912 3456 7893");
  assert.equal(groupInFours("IR820540102680020817909002"), "IR82 0540 1026 8002 0817 9090 02");
});
