import { test } from "node:test";
import assert from "node:assert/strict";
import {
  QUOTE_SUBMISSION_TTL_MS,
  createQuoteSubmission,
  quoteCartFingerprint,
  signQuoteSubmissionToken,
  verifyQuoteSubmissionToken,
} from "./quoteSubmission";

const SECRET = "quote-token-test-secret";
const CART_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const NOW = 1_760_000_000_000;
const LINES = [
  { productId: 9, qty: 2, unitPriceCents: 1250 },
  { productId: 3, qty: 1, unitPriceCents: 400 },
];

test("cart fingerprints are independent of row order", () => {
  assert.equal(quoteCartFingerprint(LINES), quoteCartFingerprint([...LINES].reverse()));
});

test("cart fingerprints change with product, quantity, or displayed price", () => {
  const original = quoteCartFingerprint(LINES);
  assert.notEqual(original, quoteCartFingerprint([{ ...LINES[0], productId: 10 }, LINES[1]]));
  assert.notEqual(original, quoteCartFingerprint([{ ...LINES[0], qty: 3 }, LINES[1]]));
  assert.notEqual(original, quoteCartFingerprint([{ ...LINES[0], unitPriceCents: 1300 }, LINES[1]]));
});

test("a signed quote submission round-trips until its expiry", () => {
  const fingerprint = quoteCartFingerprint(LINES);
  const submission = createQuoteSubmission(CART_ID, fingerprint, NOW);
  const token = signQuoteSubmissionToken(submission, SECRET);

  assert.equal(submission.expiresAtMs, NOW + QUOTE_SUBMISSION_TTL_MS);
  assert.deepEqual(verifyQuoteSubmissionToken(token, SECRET, NOW), submission);
  assert.equal(verifyQuoteSubmissionToken(token, SECRET, submission.expiresAtMs), null);
});

test("tampering, another secret, and malformed values are rejected", () => {
  const submission = createQuoteSubmission(CART_ID, quoteCartFingerprint(LINES), NOW);
  const token = signQuoteSubmissionToken(submission, SECRET);
  const [payload, signature] = token.split(".");
  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  parsed.cartId = "11111111-2222-3333-8444-555555555555";
  const forgedPayload = Buffer.from(JSON.stringify(parsed)).toString("base64url");

  assert.equal(verifyQuoteSubmissionToken(`${forgedPayload}.${signature}`, SECRET, NOW), null);
  assert.equal(verifyQuoteSubmissionToken(token, "another-test-secret", NOW), null);
  assert.equal(verifyQuoteSubmissionToken("garbage", SECRET, NOW), null);
  assert.equal(verifyQuoteSubmissionToken("x".repeat(1025), SECRET, NOW), null);
});
