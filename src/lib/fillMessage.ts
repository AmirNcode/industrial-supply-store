/**
 * Puts values into a message's `{placeholders}`, exactly as given.
 *
 * `String.prototype.replace(pattern, value)` reads `$$`, `$&`, `` $` `` and `$'`
 * in the value as special patterns. `$` is in the temporary-password alphabet,
 * so about one password in 290 was shown right on screen and shared wrong
 * (`Ab3$$x` became `Ab3$x`), and the person could not sign in with it (review
 * finding M-20). Company names and links are typed by people too. A replacer
 * function inserts its result literally, so every value goes through one.
 *
 * Use this for anything that is copied, shared or sent — credentials, pay
 * links, referral links. Unknown placeholders are left as they are.
 */
export function fillMessage(template: string, values: Record<string, string>): string {
  return template.replace(/\{([A-Za-z]+)\}/g, (whole, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : whole,
  );
}
