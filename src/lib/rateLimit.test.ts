import assert from "node:assert/strict";
import { test } from "node:test";
import { clientAddress, rateLimitIdentityHash, trustedAddressHeader } from "./rateLimit";

test("clientAddress reads only the one trusted header", () => {
  const spoofed = new Headers({
    "x-vercel-forwarded-for": "203.0.113.66",
    "x-forwarded-for": "198.51.100.9, 10.0.0.1",
    "x-real-ip": "192.0.2.10",
  });
  // Self-hosted behind nginx: the other two are whatever the client typed.
  assert.equal(clientAddress(spoofed, "x-real-ip"), "192.0.2.10");
  assert.equal(clientAddress(spoofed, "x-vercel-forwarded-for"), "203.0.113.66");
  assert.equal(clientAddress(spoofed, "x-forwarded-for"), "198.51.100.9");
  // Absent or junk in the trusted header is "unknown", not the next header down.
  assert.equal(clientAddress(new Headers({ "x-forwarded-for": "198.51.100.9" }), "x-real-ip"), "unknown");
  assert.equal(clientAddress(new Headers({ "x-real-ip": "not-an-ip" }), "x-real-ip"), "unknown");
});

test("a production server with no trusted header refuses rather than guessing", () => {
  assert.throws(() => clientAddress(new Headers({ "x-forwarded-for": "198.51.100.9" }), null));
});

test("the trusted header comes from configuration, Vercel, or development only", () => {
  assert.equal(trustedAddressHeader({ NODE_ENV: "production", TRUSTED_PROXY_HEADER: "X-Real-IP" }), "x-real-ip");
  assert.equal(trustedAddressHeader({ NODE_ENV: "production", VERCEL: "1" }), "x-vercel-forwarded-for");
  assert.equal(trustedAddressHeader({ NODE_ENV: "development" }), "x-forwarded-for");
  assert.equal(trustedAddressHeader({ NODE_ENV: "production" }), null);
  assert.throws(() => trustedAddressHeader({ NODE_ENV: "production", TRUSTED_PROXY_HEADER: "x real ip" }));
});

test("rate-limit identities are stable, scoped by kind, and do not expose the address", () => {
  const first = rateLimitIdentityHash("ip", "198.51.100.9");
  assert.equal(first, rateLimitIdentityHash("ip", "198.51.100.9"));
  assert.notEqual(first, rateLimitIdentityHash("account", "198.51.100.9"));
  assert.equal(first.length, 64);
  assert.ok(!first.includes("198.51.100.9"));
});
