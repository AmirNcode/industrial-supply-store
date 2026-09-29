"use server";

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
