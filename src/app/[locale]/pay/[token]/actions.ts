"use server";

import { redirect } from "next/navigation";
import { safeLocale } from "@/lib/i18n";
import { acceptQuote, cancelOrderForCustomer } from "@/lib/orderFlow";
import { REQUEST_LIMITS, boundedString } from "@/lib/requestLimits";
import { getOrderByPayToken } from "@/db/accountQueries";
import { acceptsPaymentProof } from "@/lib/orders";
import { isPayToken } from "@/lib/payToken";
import { DEMO_MODE } from "@/lib/demo";
import { RATE_LIMITS, consumeRateLimit } from "@/lib/rateLimit";
import { receivePaymentProof, type ProofUploadResult } from "@/lib/paymentProofUpload";

/**
 * A receipt from whoever holds the pay link — the same authority that lets
 * them see the order and its invoice. The token's shape is checked before any
 * query, and uploads are limited per link and per address, since the link is
 * the only credential.
 */
export async function uploadPaymentProofWithKeyAction(
  token: string,
  formData: FormData,
): Promise<ProofUploadResult> {
  if (DEMO_MODE || typeof token !== "string" || !isPayToken(token)) return { ok: false, problem: "closed" };
  const limit = await consumeRateLimit("proof:upload", RATE_LIMITS.proofUpload, { accountId: token });
  if (!limit.allowed) return { ok: false, problem: "rate-limited" };
  const found = await getOrderByPayToken(token);
  if (!found || !acceptsPaymentProof(found.order.status)) return { ok: false, problem: "closed" };
  return receivePaymentProof(found.order.id, formData.get("file"), { kind: "customer" });
}

/**
 * Accept a quote from the pay link. The link is the same authority that shows
 * the quote, and accepting spends nothing: it issues the pish-factor and
 * starts its 24 hours, after which an unpaid order simply lapses.
 */
export async function acceptQuoteWithKeyAction(token: string, formData: FormData): Promise<void> {
  const locale = safeLocale(formData);
  if (DEMO_MODE || typeof token !== "string" || !isPayToken(token)) redirect(`/${locale}`);
  const page = `/${locale}/pay/${token}`;
  const limit = await consumeRateLimit("proof:upload", RATE_LIMITS.proofUpload, { accountId: token });
  if (!limit.allowed) redirect(`${page}?error=rate-limit`);
  const found = await getOrderByPayToken(token);
  if (!found || found.order.status !== "quoted") redirect(page);
  const outcome = await acceptQuote(found.order.id, { kind: "customer", id: null });
  redirect(outcome === "issued" ? `${page}?ok=accepted` : `${page}?error=accept`);
}

/**
 * Cancel from the pay link — the only door a guest checkout has. Same
 * authority as accepting a quote: whoever holds the link placed the order.
 */
export async function cancelOrderWithKeyAction(token: string, formData: FormData): Promise<void> {
  const locale = safeLocale(formData);
  if (DEMO_MODE || typeof token !== "string" || !isPayToken(token)) redirect(`/${locale}`);
  const page = `/${locale}/pay/${token}`;
  const limit = await consumeRateLimit("proof:upload", RATE_LIMITS.proofUpload, { accountId: token });
  if (!limit.allowed) redirect(`${page}?error=rate-limit`);
  const found = await getOrderByPayToken(token);
  if (!found) redirect(page);
  const reason = boundedString(formData.get("reason"), REQUEST_LIMITS.cancelReasonChars) ?? "";
  const ok = await cancelOrderForCustomer(found.order.id, { kind: "customer", id: null }, reason);
  redirect(ok ? `${page}?ok=cancelled` : `${page}?error=cancel`);
}
