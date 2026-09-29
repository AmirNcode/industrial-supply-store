import { isAdmin } from "@/lib/admin";
import { currentUserId } from "@/lib/session";
import { currentRep } from "@/lib/repSession";
import { isPayToken, payTokensEqual } from "@/lib/payToken";
import { getProofAccess } from "@/db/paymentProofQueries";
import { repCanSeeOrder } from "@/db/repOrderQueries";
import { readPaymentProof } from "@/lib/paymentProofStorage";
import { isProofType, proofExtension } from "@/lib/paymentProof";

const notFound = () => new Response("Not found", { status: 404 });

/**
 * One receipt, to the people allowed to see it: the admin, the order's rep,
 * the customer who owns the order, or whoever holds its pay link (`?key=`).
 * Anyone else gets the same 404 as a receipt that does not exist.
 *
 * Deliberately not open under DEMO_MODE: a receipt carries a real person's
 * bank details, which the public demo's open admin must not publish.
 *
 * Someone with no session and no key is refused before any query, so an
 * anonymous request costs the same and says the same whatever the id.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rawKey = new URL(req.url).searchParams.get("key");
  const key = rawKey && isPayToken(rawKey) ? rawKey : null;
  const [admin, uid, rep] = await Promise.all([isAdmin(), currentUserId(), currentRep()]);
  if (!admin && !uid && !rep && !key) return notFound();

  const proof = await getProofAccess(Number(id));
  if (!proof || !isProofType(proof.contentType)) return notFound();
  const allowed =
    admin ||
    (uid !== null && proof.userId === uid) ||
    (key !== null && payTokensEqual(key, proof.payToken)) ||
    (rep !== null && (await repCanSeeOrder(rep.id, proof.orderRef)));
  if (!allowed) return notFound();

  let bytes: Uint8Array;
  try {
    bytes = await readPaymentProof(proof.storagePath);
  } catch (error) {
    console.error("payment proof read failed", error);
    return new Response("Unavailable", { status: 503 });
  }
  return new Response(bytes as BodyInit, {
    headers: {
      "Content-Type": proof.contentType,
      "Content-Disposition": `inline; filename="receipt-${Number(id)}.${proofExtension(proof.contentType)}"`,
      // Personal financial data: never stored by a shared cache, never sniffed
      // into another type, never announced to the next site by referrer.
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

/** Route handlers do not inherit the layout ceiling. */
export const maxDuration = 60;
