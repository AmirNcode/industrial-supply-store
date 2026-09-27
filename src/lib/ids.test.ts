import { test } from "node:test";
import assert from "node:assert/strict";
import { isUuid } from "./ids";

test("only canonical UUIDs pass, so a posted id can never reach a uuid column malformed", () => {
  assert.equal(isUuid("0f8fad5b-d9cb-469f-a165-70867728950e"), true);
  assert.equal(isUuid("0F8FAD5B-D9CB-469F-A165-70867728950E"), true);
  assert.equal(isUuid("0f8fad5b"), false);
  assert.equal(isUuid(""), false);
  assert.equal(isUuid("'; DROP TABLE users; --"), false);
});
