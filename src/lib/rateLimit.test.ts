import assert from "node:assert/strict";
import { test } from "node:test";
import { clientAddress, rateLimitIdentityHash } from "./rateLimit";

test("clientAddress prefers Vercel's protected forwarding header", () => {
  const values = new Headers({
    "x-vercel-forwarded-for": "2001:db8::8",
    "x-forwarded-for": "198.51.100.9, 10.0.0.1",
  });
  assert.equal(clientAddress(values), "2001:db8::8");
  assert.equal(
    clientAddress(new Headers({ "x-forwarded-for": "198.51.100.9, 10.0.0.1" })),
    "198.51.100.9",
  );
  assert.equal(clientAddress(new Headers({ "x-forwarded-for": "not-an-ip" })), "unknown");
});

test("rate-limit identities are stable, scoped by kind, and do not expose the address", () => {
  const first = rateLimitIdentityHash("ip", "198.51.100.9");
  assert.equal(first, rateLimitIdentityHash("ip", "198.51.100.9"));
  assert.notEqual(first, rateLimitIdentityHash("account", "198.51.100.9"));
  assert.equal(first.length, 64);
  assert.ok(!first.includes("198.51.100.9"));
});
