import { test } from "node:test";
import assert from "node:assert/strict";
import { STAFF_EMAIL_LIMIT, parseStaffEmailList } from "./staffEmailValues";

test("staff emails: personal addresses kept, duplicates and junk dropped", () => {
  assert.deepEqual(
    parseStaffEmailList(JSON.stringify(["Ali.Rezaei@Gmail.com", "ali.rezaei@gmail.com", "nope", 7, "sara@hotmail.com"])),
    ["ali.rezaei@gmail.com", "sara@hotmail.com"],
  );
});

test("staff emails: a malformed setting reads as an empty list", () => {
  assert.deepEqual(parseStaffEmailList("not json"), []);
  assert.deepEqual(parseStaffEmailList('{"a":1}'), []);
});

test("staff emails: never more than the limit", () => {
  const many = Array.from({ length: STAFF_EMAIL_LIMIT + 3 }, (_, i) => `s${i}@gmail.com`);
  assert.equal(parseStaffEmailList(JSON.stringify(many)).length, STAFF_EMAIL_LIMIT);
});
