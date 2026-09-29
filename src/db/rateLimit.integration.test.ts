import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "./index";
import { consumeAccountCounter, consumeRateLimit, peekAccountCounter } from "@/lib/rateLimit";

function assertLocalDatabase(): void {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is required for the database integration test");
  const { hostname } = new URL(raw);
  if (hostname !== "localhost" && hostname !== "127.0.0.1") {
    throw new Error(`Refusing to run rate-limit integration tests against non-local host: ${hostname}`);
  }
}

test("a shared counter atomically refuses requests after its fixed-window allowance", async () => {
  assertLocalDatabase();
  const scope = `integration:${randomUUID()}`;
  const headers = new Headers({ "x-forwarded-for": "198.51.100.44" });
  try {
    const policy = { limit: 2, windowSeconds: 60 };
    const [first, second, third] = await Promise.all([
      consumeRateLimit(scope, policy, { headers }),
      consumeRateLimit(scope, policy, { headers }),
      consumeRateLimit(scope, policy, { headers }),
    ]);
    const results = [first, second, third];
    assert.equal(results.filter((result) => result.allowed).length, 2);
    assert.equal(results.filter((result) => !result.allowed).length, 1);
    const denied = results.find((result) => !result.allowed)!;
    assert.ok(
      denied.retryAfter >= 1 && denied.retryAfter <= 60,
      `unexpected retry value: ${JSON.stringify(results)}`,
    );

    const [stored] = await sql<{ count: number }[]>`
      SELECT request_count::int AS count FROM request_rate_limits WHERE scope = ${scope}
    `;
    assert.equal(stored.count, 3);
  } finally {
    await sql`DELETE FROM request_rate_limits WHERE scope = ${scope}`;
  }
});

after(async () => {
  await sql.end({ timeout: 5 });
});

test("account failures are counted per login, whatever the address, and peeking adds none", async () => {
  // Review M-1: the per-address limit alone let a spread-out guesser try one
  // account without end. lib/signInGuard.ts reads and writes these counters.
  assertLocalDatabase();
  const scope = `integration:${randomUUID()}`;
  const policy = { limit: 3, windowSeconds: 60 };
  try {
    assert.equal(await peekAccountCounter(scope, policy, "code:1234567"), 0);
    for (let i = 0; i < 3; i++) await consumeAccountCounter(scope, policy, "code:1234567");
    assert.equal(await peekAccountCounter(scope, policy, "code:1234567"), 3);
    assert.equal(await peekAccountCounter(scope, policy, "code:1234567"), 3, "peeking must not count");
    assert.equal(await peekAccountCounter(scope, policy, "code:7654321"), 0, "another login is unaffected");
    // An expired window reads as empty.
    await sql`UPDATE request_rate_limits SET window_started_at = now() - interval '2 minutes' WHERE scope = ${scope}`;
    assert.equal(await peekAccountCounter(scope, policy, "code:1234567"), 0);
  } finally {
    await sql`DELETE FROM request_rate_limits WHERE scope = ${scope}`;
  }
});
