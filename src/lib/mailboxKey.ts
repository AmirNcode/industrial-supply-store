/**
 * The inbox an email address delivers to, for counting — never for sending or
 * storing. `a.b+orders@gmail.com`, `ab@googlemail.com` and `AB@gmail.com.` are
 * one mailbox, so a per-address limit keyed on the typed text could be walked
 * around by decorating the address (review R-5). The `+tag` is dropped for
 * every domain: nearly all providers treat it as a tag, and where one does
 * not, two real people sharing a counter is the cheap direction to be wrong
 * in. Dots are dropped only where they are known to mean nothing (Gmail).
 */
export function mailboxKey(email: string): string {
  const typed = email.trim().toLowerCase();
  const at = typed.lastIndexOf("@");
  if (at < 1) return typed;
  let local = typed.slice(0, at).split("+", 1)[0];
  let domain = typed.slice(at + 1).replace(/\.+$/, "");
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") local = local.replaceAll(".", "");
  return `${local}@${domain}`;
}
