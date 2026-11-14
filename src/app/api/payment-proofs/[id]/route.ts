import { isAdmin } from "@/lib/admin";
import { currentUserId } from "@/lib/session";
import { currentRep } from "@/lib/repSession";
import { getProofAccess } from "@/db/paymentProofQueries";
import { repCanActOnOrder } from "@/db/repOrderQueries";
import { readPaymentProof } from "@/lib/paymentProofStorage";
import { isProofType, proofExtension } from "@/lib/paymentProof";

const notFound = () => new Response("Not found", { status: 404 });

/**
 * One receipt, to the people allowed to see it: the signed-in admin, the rep
 * the order is credited to (not a rep who merely inherited the customer), or
 * the signed-in customer who owns the order. Anyone else gets
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
  const [admin, uid, signedInRep] = await Promise.all([isAdmin(), currentUserId(), currentRep()]);
  // A rep still on a temporary password has not finished signing in: every
  // rep page sends them to the password form first, and so does this.
  const rep = signedInRep && !signedInRep.mustChangePassword ? signedInRep : null;
  if (!admin && !uid && !rep) return notFound();

  const proof = await getProofAccess(Number(id));
  if (!proof || !isProofType(proof.contentType)) return notFound();
  const allowed =
    admin ||
    (uid !== null && proof.userId === uid) ||
    (rep !== null && (await repCanActOnOrder(rep.id, proof.orderRef)));
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
      // A PDF is downloaded, never opened in the page: a PDF can carry script,
      // and opened inline it would run on the site's own address inside a
      // signed-in staff session. Images are inert and stay viewable in place.
      "Content-Disposition": `${proof.contentType === "application/pdf" ? "attachment" : "inline"}; filename="receipt-${Number(id)}.${proofExtension(proof.contentType)}"`,
      // Whatever the file claims to be, it may load and run nothing.
      "Content-Security-Policy": "default-src 'none'; sandbox",
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
