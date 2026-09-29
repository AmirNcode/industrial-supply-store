import { isAdmin } from "@/lib/admin";
import { currentUserId } from "@/lib/session";
import { currentRep } from "@/lib/repSession";
import { getProofAccess } from "@/db/paymentProofQueries";
import { repCanSeeOrder } from "@/db/repOrderQueries";
import { readPaymentProof } from "@/lib/paymentProofStorage";
import { isProofType, proofExtension } from "@/lib/paymentProof";

const notFound = () => new Response("Not found", { status: 404 });

/**
 * One receipt, to the people allowed to see it: the signed-in admin, the
 * order's rep, or the signed-in customer who owns the order. Anyone else gets
 * the same 404 as a receipt that does not exist.
 *
 * A pay link does not open receipts, though it can upload them. Receipts
 * carry bank and card details; a pay link is a bearer credential that travels
 * through messaging apps and can be forwarded, and the person who sent the
 * receipt already has the file. Under DEMO_MODE `isAdmin()` stays false (the
 * demo's panel is public without signing in), so the demo serves none.
 *
 * Someone with no session is refused before any query, so an anonymous
 * request costs the same and says the same whatever the id.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [admin, uid, rep] = await Promise.all([isAdmin(), currentUserId(), currentRep()]);
  if (!admin && !uid && !rep) return notFound();

  const proof = await getProofAccess(Number(id));
  if (!proof || !isProofType(proof.contentType)) return notFound();
  const allowed =
    admin ||
    (uid !== null && proof.userId === uid) ||
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
