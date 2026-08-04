import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

/**
 * scrypt from node:crypto, not argon2 or bcrypt.
 *
 * Both of those are native modules, and a native module is a build failure
 * waiting to happen on a managed platform — the wrong prebuilt binary, a Node
 * version bump, a different libc in the build image. scrypt is memory-hard,
 * built in, and has no install step. The cost is that the parameters are ours
 * to choose rather than a library's to default.
 *
 * The stored form carries its own parameters, so raising them later does not
 * invalidate existing hashes: an old row verifies with the numbers it was
 * written with.
 */
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;
const SALT_BYTES = 16;

export const MIN_PASSWORD_LENGTH = 8;

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await scrypt(plain, salt, KEYLEN, { N, r: R, p: P });
  return ["scrypt", N, R, P, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4], "base64");
    expected = Buffer.from(parts[5], "base64");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  let actual: Buffer;
  try {
    actual = await scrypt(plain, salt, expected.length, { N: n, r, p });
  } catch {
    // Absurd stored parameters can make scrypt refuse outright. That is a
    // corrupt row, not a valid password.
    return false;
  }

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
