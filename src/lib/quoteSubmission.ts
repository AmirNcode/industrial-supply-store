import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

/** A quote form may stay open through a working day, but should not live forever. */
export const QUOTE_SUBMISSION_TTL_MS = 24 * 60 * 60 * 1000;

export type QuoteSubmission = {
  submissionKey: string;
  cartId: string;
  cartFingerprint: string;
  expiresAtMs: number;
};

type FingerprintLine = {
  productId: number;
  qty: number;
  unitPriceCents: number;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;
const MAX_TOKEN_LENGTH = 1024;

/**
 * A stable revision for the cart the buyer actually reviewed.
 *
 * Price is included as well as product and quantity: silently accepting a
 * catalog-price change between render and submit would create an order whose
 * requested total differs from the total beside the submit button.
 */
export function quoteCartFingerprint(lines: readonly FingerprintLine[]): string {
  const canonical = [...lines]
    .sort((a, b) => a.productId - b.productId)
    .map(({ productId, qty, unitPriceCents }) => [productId, qty, unitPriceCents]);
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`isupply-quote-v1.${payload}`)
    .digest("base64url");
}

export function createQuoteSubmission(
  cartId: string,
  cartFingerprint: string,
  nowMs: number = Date.now(),
): QuoteSubmission {
  return {
    submissionKey: randomUUID(),
    cartId,
    cartFingerprint,
    expiresAtMs: nowMs + QUOTE_SUBMISSION_TTL_MS,
  };
}

export function signQuoteSubmissionToken(
  submission: QuoteSubmission,
  secret: string,
): string {
  const payload = Buffer.from(JSON.stringify(submission)).toString("base64url");
  return `${payload}.${signature(payload, secret)}`;
}

/** Returns the signed submission, or null for malformed, forged, or expired input. */
export function verifyQuoteSubmissionToken(
  token: string,
  secret: string,
  nowMs: number = Date.now(),
): QuoteSubmission | null {
  if (!token || token.length > MAX_TOKEN_LENGTH) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, provided] = parts;
  if (!payload || !provided) return null;

  const expected = signature(payload, secret);
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const value = parsed as Partial<QuoteSubmission>;
  if (
    typeof value.submissionKey !== "string" ||
    !UUID_RE.test(value.submissionKey) ||
    typeof value.cartId !== "string" ||
    !UUID_RE.test(value.cartId) ||
    typeof value.cartFingerprint !== "string" ||
    !SHA256_RE.test(value.cartFingerprint) ||
    typeof value.expiresAtMs !== "number" ||
    !Number.isSafeInteger(value.expiresAtMs) ||
    value.expiresAtMs <= nowMs
  ) {
    return null;
  }

  return value as QuoteSubmission;
}
