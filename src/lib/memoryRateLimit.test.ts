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

test("a full table makes room without forgetting the visitors over their limit", () => {
  const allow = createMemoryRateLimit({ limit: 2, windowSeconds: 60 });
  // Exactly at the limit, not yet refused: must survive the eviction too.
  assert.equal(allow("heavy", 0).allowed, true);
  assert.equal(allow("heavy", 0).allowed, true);
  for (let i = 0; i < 4_999; i++) assert.equal(allow(`k${i}`, 0).allowed, true);
  // Full of visitors under their limit: a newcomer still gets in, and the
  // flood did not hand the heavy one a fresh count.
  assert.equal(allow("newcomer", 1_000).allowed, true);
  assert.equal(allow("heavy", 1_000).allowed, false);
  assert.equal(allow("heavy", 60_000).allowed, true);
});
