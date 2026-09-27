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
