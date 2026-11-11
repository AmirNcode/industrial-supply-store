import "server-only";
import { sql } from "./index";
import { AUTH_SECRET } from "@/lib/authSecret";
import {
  LOGIN_CODE_MAX_ATTEMPTS,
  LOGIN_CODE_TTL_MINUTES,
  hashLoginCode,
  loginCodeMatches,
  newLoginCode,
} from "@/lib/loginCode";

/**
 * A fresh code for the account; any earlier unused one stops working, so the
 * newest email is always the one that counts and an old one cannot be tried
 * alongside it. Returns the code for the caller to email — it is stored only
 * as a hash.
 */
export async function issueLoginCode(userId: string): Promise<string> {
  const code = newLoginCode();
  await sql.begin(async (tx) => {
    await tx`UPDATE login_codes SET consumed_at = now() WHERE user_id = ${userId} AND consumed_at IS NULL`;
    await tx`
      INSERT INTO login_codes (user_id, code_hash, expires_at)
      VALUES (${userId}, ${hashLoginCode(userId, code, AUTH_SECRET)},
              now() + make_interval(mins => ${LOGIN_CODE_TTL_MINUTES}))
    `;
  });
  return code;
}

export type CodeCheck = "ok" | "wrong" | "expired";

/**
 * Checks a typed code against the account's live one and, when it matches,
 * spends it and marks the address verified — in one transaction, with the row
 * locked, so the same code cannot sign two browsers in and a burst of guesses
 * cannot outrun the attempt counter. A wrong guess is counted; at the limit
 * the code is spent and a new one must be requested.
 */
export async function redeemLoginCode(userId: string, code: string): Promise<CodeCheck> {
  return sql.begin(async (tx) => {
    const [row] = await tx<{ id: number; codeHash: string; attempts: number }[]>`
      SELECT id, code_hash AS "codeHash", attempts
      FROM login_codes
      WHERE user_id = ${userId} AND consumed_at IS NULL AND expires_at > now()
      ORDER BY id DESC
      LIMIT 1
      FOR UPDATE
    `;
    if (!row) return "expired";
    if (!loginCodeMatches(userId, code, row.codeHash, AUTH_SECRET)) {
      const spent = row.attempts + 1 >= LOGIN_CODE_MAX_ATTEMPTS;
      await tx`
        UPDATE login_codes
        SET attempts = attempts + 1, consumed_at = CASE WHEN ${spent} THEN now() ELSE consumed_at END
        WHERE id = ${row.id}
      `;
      return spent ? "expired" : "wrong";
    }
    await tx`UPDATE login_codes SET consumed_at = now() WHERE id = ${row.id}`;
    // Proving the inbox is what verifies the address. The stored password is
    // no longer trusted from here: the account is sent to choose one
    // (`needsPassword` in userQueries), which also ends every older session.
    await tx`
      UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = ${userId}
    `;
    return "ok";
  });
}
