/**
 * Normalising a reference someone typed off a printed confirmation or read
 * back over the phone.
 *
 * The alphabet omits O/0 and I/1 precisely so it survives being read aloud, so
 * a reference containing one of them is a transcription error rather than a
 * lookup — refusing it here gives a clearer answer than a database miss would.
 *
 * Kept free of imports so it can be tested without a database.
 */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const BODY = new RegExp(`^[${ALPHABET}]{6}$`);

export function normaliseRef(raw: string): string | null {
  const trimmed = raw.trim().toUpperCase();
  const body = trimmed.replace(/^(ORD|RFQ)-/, "");
  return BODY.test(body) ? `ORD-${body}` : null;
}
