import { test } from "node:test";
import assert from "node:assert/strict";
import {
  commissionPercentLabel,
  repMayResetPassword,
  formatCommissionPercent,
  isReferralCode,
  isValidUsername,
  normalizeUsername,
  parseCommissionPercent,
  randomReferralCode,
} from "./repAccount";

test("usernames are stored lower-case and must fit the database rule", () => {
  assert.equal(normalizeUsername("  Sara.Ahmadi "), "sara.ahmadi");
  assert.equal(isValidUsername("sara.ahmadi"), true);
  assert.equal(isValidUsername("rep_01-x"), true);
  assert.equal(isValidUsername("sa"), false);
  assert.equal(isValidUsername("sara ahmadi"), false);
  assert.equal(isValidUsername("سارا"), false);
  assert.equal(isValidUsername("a".repeat(33)), false);
});

test("a typed percent becomes basis points: two decimals, 0–100, any keyboard", () => {
  assert.equal(parseCommissionPercent("2.5"), 250);
  assert.equal(parseCommissionPercent("2.55"), 255);
  assert.equal(parseCommissionPercent("0"), 0);
  assert.equal(parseCommissionPercent("100"), 10_000);
  assert.equal(parseCommissionPercent("۲٫۵"), 250);
  assert.equal(parseCommissionPercent("۱۰"), 1000);
  assert.equal(parseCommissionPercent("5%"), 500);
  assert.equal(parseCommissionPercent("۵٪"), 500);
  assert.equal(parseCommissionPercent("2.555"), null);
  assert.equal(parseCommissionPercent("100.01"), null);
  assert.equal(parseCommissionPercent("-1"), null);
  assert.equal(parseCommissionPercent(""), null);
  assert.equal(parseCommissionPercent("abc"), null);
});

test("basis points back to the percent a form shows", () => {
  assert.equal(formatCommissionPercent(250), "2.5");
  assert.equal(formatCommissionPercent(255), "2.55");
  assert.equal(formatCommissionPercent(1000), "10");
  assert.equal(formatCommissionPercent(5), "0.05");
  assert.equal(formatCommissionPercent(0), "0");
  assert.equal(formatCommissionPercent(10_000), "100");
});

test("a commission label in each language", () => {
  assert.equal(commissionPercentLabel(250, "en"), "2.5%");
  assert.equal(commissionPercentLabel(250, "fa"), "۲٫۵٪");
});

test("referral codes use the read-aloud alphabet", () => {
  for (let i = 0; i < 200; i++) {
    const code = randomReferralCode();
    assert.equal(isReferralCode(code), true);
    assert.doesNotMatch(code, /[IO01]/);
  }
  assert.equal(isReferralCode("ABC123"), false);
  assert.equal(isReferralCode("abcdef"), false);
  assert.equal(isReferralCode("ABCDE"), false);
});

test("a rep may reset only a customer they created who has never chosen a password", () => {
  const own = { origin: "rep", originRepId: "rep-a", choseOwnPassword: false };
  assert.equal(repMayResetPassword(own, "rep-a"), true);
  assert.equal(repMayResetPassword({ ...own, choseOwnPassword: true }, "rep-a"), false);
  assert.equal(repMayResetPassword(own, "rep-b"), false);
  assert.equal(repMayResetPassword({ origin: "self", originRepId: null, choseOwnPassword: false }, "rep-a"), false);
  assert.equal(repMayResetPassword({ ...own, origin: "referral" }, "rep-a"), false);
});
