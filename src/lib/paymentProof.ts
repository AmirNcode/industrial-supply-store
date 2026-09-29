/**
 * Proof of payment: what a receipt upload may be.
 *
 * Free of imports so the upload control, the actions and the tests share one
 * definition. Kept to photos and PDFs — what a banking app's "share receipt"
 * produces — and judged by the file's own first bytes, never its name or the
 * type the browser claims, because the file is later served back to the admin
 * and a rep from this site.
 */

export const PROOF_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export type ProofType = (typeof PROOF_TYPES)[number];

/**
 * Under the 4.25 MB a Server Action accepts, with room for the form around it.
 * Photos are shrunk in the browser before upload, so only a PDF comes near it.
 */
export const PROOF_MAX_BYTES = 4_000_000;

/** Enough for part payments and a retake or two; a bound on what a pay link can store. */
export const PROOF_MAX_PER_ORDER = 10;

/** The longest side a receipt photo is shrunk to: still legible, a few hundred KB. */
export const PROOF_IMAGE_MAX_SIDE = 1_800;

const EXTENSION: Record<ProofType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export function proofExtension(type: ProofType): string {
  return EXTENSION[type];
}

export function isProofType(value: string): value is ProofType {
  return (PROOF_TYPES as readonly string[]).includes(value);
}

/** The file's real type from its signature, or null for anything else. */
export function sniffProofType(bytes: Uint8Array): ProofType | null {
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  const ascii = (at: number, text: string) =>
    [...text].every((ch, i) => bytes[at + i] === ch.charCodeAt(0));
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "image/webp";
  if (ascii(0, "%PDF-")) return "application/pdf";
  return null;
}

export type ProofProblem = "empty" | "too-large" | "bad-type";

/** Why a file cannot be a receipt, or null when it can. */
export function proofProblem(bytes: Uint8Array): ProofProblem | null {
  if (bytes.byteLength === 0) return "empty";
  if (bytes.byteLength > PROOF_MAX_BYTES) return "too-large";
  return sniffProofType(bytes) ? null : "bad-type";
}
