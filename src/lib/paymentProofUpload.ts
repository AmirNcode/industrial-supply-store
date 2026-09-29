import "server-only";

import { addPaymentProof } from "@/db/paymentProofQueries";
import { PROOF_MAX_BYTES, proofProblem, sniffProofType } from "./paymentProof";
import { discardPaymentProof, storePaymentProof } from "./paymentProofStorage";

export type ProofUploadProblem =
  | "empty"
  | "too-large"
  | "bad-type"
  | "closed"
  | "full"
  | "failed"
  | "rate-limited";

export type ProofUploadResult = { ok: true } | { ok: false; problem: ProofUploadProblem };

/**
 * One receipt, from any of the three places that take one — the customer's
 * order page, the pay link, the rep's order page. Each caller has already
 * decided who may upload to this order; this decides whether the file is a
 * receipt and records it.
 *
 * The file is stored before its row is written, because Storage cannot join a
 * database transaction. When the row is then refused — the order was confirmed
 * or cancelled a moment ago, or already holds the maximum — the stored file
 * is removed again.
 */
export async function receivePaymentProof(
  orderId: number,
  entry: FormDataEntryValue | null,
  by: { kind: "customer" } | { kind: "rep"; repId: string },
): Promise<ProofUploadResult> {
  if (!(entry instanceof File) || entry.size === 0) return { ok: false, problem: "empty" };
  // Refused before the body is read into memory.
  if (entry.size > PROOF_MAX_BYTES) return { ok: false, problem: "too-large" };
  const bytes = new Uint8Array(await entry.arrayBuffer());
  const problem = proofProblem(bytes);
  if (problem) return { ok: false, problem };
  const type = sniffProofType(bytes)!;

  let path: string;
  try {
    path = await storePaymentProof(orderId, bytes, type);
  } catch (error) {
    console.error("payment proof upload failed", error);
    return { ok: false, problem: "failed" };
  }
  const result = await addPaymentProof(orderId, { path, type, size: bytes.byteLength }, by);
  if (result !== "added") {
    await discardPaymentProof(path);
    return { ok: false, problem: result };
  }
  return { ok: true };
}
