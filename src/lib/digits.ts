/**
 * Persian (U+06F0–U+06F9) and Arabic-Indic (U+0660–U+0669) digits to ASCII.
 *
 * A Persian phone keyboard types ۰–۹ and an Arabic one ٠–٩. Every identifier
 * and amount someone types here — a customer ID, a phone, a password, a rial
 * amount — has to mean the same thing whichever keyboard produced it.
 */
export function latinDigits(value: string): string {
  return value.replace(/[۰-۹٠-٩]/g, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code - (code >= 0x06f0 ? 0x06f0 : 0x0660));
  });
}

const ANY_DIGIT = /[0-9۰-۹٠-٩]/;

/**
 * A whole amount as it is typed, with thousands marks: "10000000" →
 * "10,000,000". Everything but digits is dropped first, so pasting an amount
 * that already has marks (or spaces) regroups it rather than doubling them.
 *
 * The digits stay in the script they were typed in, and Persian digits get the
 * Persian thousands mark (٬) — "۱۰٬۰۰۰٬۰۰۰" is how that number is written,
 * where a Latin comma between Persian digits reads as a list. `parseRialAmount`
 * accepts both marks, so either form posts unchanged.
 */
export function groupDigits(value: string): string {
  const digits = Array.from(value).filter((ch) => ANY_DIGIT.test(ch));
  const mark = digits.some((ch) => /[۰-۹٠-٩]/.test(ch)) ? "٬" : ",";
  let out = "";
  digits.forEach((digit, i) => {
    if (i > 0 && (digits.length - i) % 3 === 0) out += mark;
    out += digit;
  });
  return out;
}

/** How many digits sit before `index` in `value` — what a caret keeps across regrouping. */
export function digitsBefore(value: string, index: number): number {
  return Array.from(value.slice(0, index)).filter((ch) => ANY_DIGIT.test(ch)).length;
}

/** The caret position just after the `count`-th digit of `value`. */
export function indexAfterDigits(value: string, count: number): number {
  if (count <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < value.length; i++) {
    if (ANY_DIGIT.test(value[i]) && ++seen === count) return i + 1;
  }
  return value.length;
}
