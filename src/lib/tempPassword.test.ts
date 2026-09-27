import { test } from "node:test";
import assert from "node:assert/strict";
import { generateTempPassword } from "./tempPassword";
import { repPasswordProblems } from "./repPassword";

test("every temporary password already passes the rep rule and avoids misreadable characters", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 300; i++) {
    const p = generateTempPassword();
    assert.equal(p.length, 12);
    assert.deepEqual(repPasswordProblems(p), []);
    assert.doesNotMatch(p, /[0O1lI]/);
    seen.add(p);
  }
  assert.equal(seen.size, 300);
});
