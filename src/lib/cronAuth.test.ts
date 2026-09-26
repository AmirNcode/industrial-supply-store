import { test } from "node:test";
import assert from "node:assert/strict";
import { isAuthorizedCron } from "./cronAuth";

const SECRET = "a-cron-secret-long-enough";

test("the scheduler's bearer header is accepted", () => {
  assert.equal(isAuthorizedCron(`Bearer ${SECRET}`, SECRET), true);
});

test("a wrong, missing or differently shaped header is refused", () => {
  assert.equal(isAuthorizedCron("Bearer something-else-entirely", SECRET), false);
  assert.equal(isAuthorizedCron(SECRET, SECRET), false);
  assert.equal(isAuthorizedCron(null, SECRET), false);
  assert.equal(isAuthorizedCron("", SECRET), false);
});

test("an unset or short secret refuses everything, even a matching header", () => {
  assert.equal(isAuthorizedCron("Bearer ", undefined), false);
  assert.equal(isAuthorizedCron("Bearer ", ""), false);
  assert.equal(isAuthorizedCron("Bearer short", "short"), false);
});
