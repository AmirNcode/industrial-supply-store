import { latinDigits } from "./digits";
import { MIN_PASSWORD_LENGTH } from "./password";

export type RepPasswordProblem = "short" | "uppercase" | "digit" | "special";

/**
 * The same password whichever keyboard typed its digits.
 *
 * A rep who sets "Tehran۱۴۰۵!" on a phone and later types "Tehran1405!" on a
 * laptop typed the same thing as far as they can tell. Hashing and verifying
 * both go through this, so the two match.
 */
export function normalizeRepPassword(plain: string): string {
  return latinDigits(plain);
}

/** Every rule missed, in a fixed order, so the form can explain all of them at once. */
export function repPasswordProblems(plain: string): RepPasswordProblem[] {
  const value = normalizeRepPassword(plain);
  const problems: RepPasswordProblem[] = [];
  if ([...value].length < MIN_PASSWORD_LENGTH) problems.push("short");
  if (!/[A-Z]/.test(value)) problems.push("uppercase");
  if (!/[0-9]/.test(value)) problems.push("digit");
  if (!/[^\p{L}\p{N}\s]/u.test(value)) problems.push("special");
  return problems;
}
