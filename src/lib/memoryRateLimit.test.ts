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

test("a full table refuses new visitors instead of forgetting the ones over their limit", () => {
  const allow = createMemoryRateLimit({ limit: 1, windowSeconds: 60 });
  assert.equal(allow("heavy", 0).allowed, true);
  assert.equal(allow("heavy", 0).allowed, false);
  for (let i = 0; i < 4_999; i++) assert.equal(allow(`k${i}`, 0).allowed, true);
  // Full: a new address is refused, and flooding did not reset the heavy one.
  assert.equal(allow("newcomer", 1_000).allowed, false);
  assert.equal(allow("heavy", 1_000).allowed, false);
  // Once the windows lapse there is room again.
  assert.equal(allow("newcomer", 60_000).allowed, true);
});
