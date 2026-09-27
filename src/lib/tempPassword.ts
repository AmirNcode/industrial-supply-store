import { randomInt } from "node:crypto";

const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghjkmnpqrstuvwxyz";
const DIGIT = "23456789";
const SPECIAL = "!@#$%*+=?";
const ALL = UPPER + LOWER + DIGIT + SPECIAL;

function pick(set: string): string {
  return set[randomInt(set.length)];
}

/**
 * Twelve characters with at least one of each class, so it already passes the
 * rep password rule — a temporary password can never be refused by the form
 * it is typed into. No 0/O or 1/l/I, because these get read out over the phone.
 */
export function generateTempPassword(): string {
  const chars = [pick(UPPER), pick(LOWER), pick(DIGIT), pick(SPECIAL)];
  while (chars.length < 12) chars.push(pick(ALL));
  // Fisher–Yates, so the four guaranteed classes are not always the first four.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}
