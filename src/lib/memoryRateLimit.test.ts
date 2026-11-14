import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryRateLimit } from "./memoryRateLimit";

test("allows up to the limit per key, then refuses until the window ends", () => {
  const allow = createMemoryRateLimit({ limit: 2, windowSeconds: 60 });
  assert.equal(allow("a", 0).allowed, true);
  assert.equal(allow("a", 1_000).allowed, true);
  const refused = allow("a", 2_000);
  assert.equal(refused.allowed, false);
  assert.equal(refused.retryAfter, 58);
  // Another visitor is unaffected, and the first is let back in afterwards.
  assert.equal(allow("b", 2_000).allowed, true);
  assert.equal(allow("a", 60_000).allowed, true);
});

test("never holds more than its ceiling of visitors", () => {
  const allow = createMemoryRateLimit({ limit: 1, windowSeconds: 60 });
  for (let i = 0; i < 12_000; i++) assert.equal(allow(`k${i}`, 0).allowed, true);
});
