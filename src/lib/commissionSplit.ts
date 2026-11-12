import { latinDigits } from "@/lib/digits";

// Pure on purpose (no server-only import): the admin form validates with the
// same rules the server action enforces, so the two can never disagree.

export const MAX_ACCOUNT_REPS = 5;
export const FULL_SHARE_BP = 10_000;

/** One row of an account's list, in the order the reps were added. */
export type SplitRow = { repId: string; shareBp: number | null };
export type SplitProblem = "empty" | "too-many" | "duplicate" | "mixed" | "total";

/**
 * null when the list may be saved. An empty list is reported as "empty" so the
 * caller decides whether it is allowed (unassigning an account is valid).
 */
export function splitProblem(rows: readonly SplitRow[]): SplitProblem | null {
  if (rows.length === 0) return "empty";
  if (rows.length > MAX_ACCOUNT_REPS) return "too-many";
  if (new Set(rows.map((row) => row.repId)).size !== rows.length) return "duplicate";
  const blank = rows.filter((row) => row.shareBp === null).length;
  if (blank === rows.length) return null; // all blank = equal split
  // Half-filled is refused rather than guessed: "the rest" is ambiguous with
  // three reps, and a wrong guess is wrong money.
  if (blank > 0) return "mixed";
  const total = rows.reduce((sum, row) => sum + (row.shareBp ?? 0), 0);
  return total === FULL_SHARE_BP ? null : "total";
}

/**
 * Blank shares become equal ones; the remainder goes to the first row so the
 * shares always add to exactly 10000. Filled shares pass through. Callers
 * check `splitProblem` first, so a mix of blank and filled never gets here
 * (a blank among filled rows resolves to 0).
 */
export function resolveShares(rows: readonly SplitRow[]): { repId: string; shareBp: number }[] {
  const allBlank = rows.every((row) => row.shareBp === null);
  if (!allBlank) return rows.map((row) => ({ repId: row.repId, shareBp: row.shareBp ?? 0 }));
  const each = Math.floor(FULL_SHARE_BP / rows.length);
  const extra = FULL_SHARE_BP - each * rows.length;
  return rows.map((row, i) => ({ repId: row.repId, shareBp: i === 0 ? each + extra : each }));
}

/** Biggest resolved share; on a tie the earliest row. null for an empty list. */
export function leadRepId(rows: readonly SplitRow[]): string | null {
  let lead: { repId: string; shareBp: number } | null = null;
  // Strictly greater, so an equal later row never displaces the earlier one.
  for (const row of resolveShares(rows)) if (!lead || row.shareBp > lead.shareBp) lead = row;
  return lead?.repId ?? null;
}

/** "" -> null (blank); whole 1..100, Persian/Arabic digits and surrounding spaces allowed -> bp; anything else -> "invalid". */
export function parseSharePercent(raw: string): number | null | "invalid" {
  const text = latinDigits(raw).trim();
  if (text === "") return null;
  if (!/^\d{1,3}$/.test(text)) return "invalid";
  const percent = Number(text);
  if (percent < 1 || percent > 100) return "invalid";
  return percent * 100;
}
