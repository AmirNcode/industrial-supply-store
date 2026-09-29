import "server-only";

import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { headers as nextHeaders } from "next/headers";
import { sql } from "@/db";
import { AUTH_SECRET } from "./authSecret";

export type RateLimitPolicy = Readonly<{
  limit: number;
  windowSeconds: number;
}>;

/** Deliberately named policies make call sites reviewable at a glance. */
export const RATE_LIMITS = {
  adminLogin: { limit: 8, windowSeconds: 15 * 60 },
  // Every admin sign-in attempt from anywhere, together. The admin password is
  // shared and has no account to key on, so a guesser spread over many
  // addresses meets only this ceiling. Far above what a small staff uses.
  adminLoginGlobal: { limit: 60, windowSeconds: 15 * 60 },
  accountSignIn: { limit: 10, windowSeconds: 15 * 60 },
  accountSignUp: { limit: 5, windowSeconds: 60 * 60 },
  accountWrite: { limit: 30, windowSeconds: 10 * 60 },
  cartWrite: { limit: 120, windowSeconds: 60 },
  quickOrder: { limit: 12, windowSeconds: 60 },
  quoteSubmit: { limit: 5, windowSeconds: 10 * 60 },
  suggest: { limit: 180, windowSeconds: 60 },
  guestTracking: { limit: 30, windowSeconds: 10 * 60 },
  importPrepare: { limit: 10, windowSeconds: 60 * 60 },
  importProcess: { limit: 30, windowSeconds: 60 * 60 },
  repSignIn: { limit: 10, windowSeconds: 15 * 60 },
  repWrite: { limit: 60, windowSeconds: 10 * 60 },
  repOrderSubmit: { limit: 30, windowSeconds: 10 * 60 },
  // Per pay link and per address: the link alone authorises an upload, so it
  // is what bounds how much anyone holding one can store.
  proofUpload: { limit: 20, windowSeconds: 60 * 60 },
} as const satisfies Record<string, RateLimitPolicy>;

type HeaderSource = Pick<Headers, "get">;

/**
 * The one request header the client address is read from — never a list.
 *
 * Reading the first of several forwarding headers let a client choose its own
 * address on any server where the platform does not overwrite them: Next only
 * fills `x-forwarded-for` when it is absent and nothing strips
 * `x-vercel-forwarded-for`, so on the self-hosted server a random header per
 * request voided every limit, the admin sign-in included (review H-5).
 *
 *   - `TRUSTED_PROXY_HEADER`, when set: the header the deployment's own reverse
 *     proxy *overwrites* (the compose stack's nginx sets `x-real-ip`).
 *   - on Vercel: `x-vercel-forwarded-for`, which the platform sets.
 *   - in development: `x-forwarded-for`, which Next fills for local requests.
 *   - a production server with neither is refused (`clientAddress` throws),
 *     because there is no header it could trust.
 */
export function trustedAddressHeader(env: NodeJS.ProcessEnv = process.env): string | null {
  const configured = env.TRUSTED_PROXY_HEADER?.trim().toLowerCase();
  if (configured) {
    if (!/^[a-z0-9-]{1,64}$/.test(configured)) throw new Error("TRUSTED_PROXY_HEADER is not a header name");
    return configured;
  }
  if (env.VERCEL) return "x-vercel-forwarded-for";
  if (env.NODE_ENV !== "production") return "x-forwarded-for";
  return null;
}

export function clientAddress(source: HeaderSource, header = trustedAddressHeader()): string {
  if (header === null) {
    throw new Error(
      "Set TRUSTED_PROXY_HEADER to the header your reverse proxy overwrites with the client address (e.g. x-real-ip)",
    );
  }
  const candidate = source.get(header)?.split(",", 1)[0]?.trim();
  return candidate && isIP(candidate) ? candidate : "unknown";
}

export function rateLimitIdentityHash(kind: "ip" | "account", value: string): string {
  return createHmac("sha256", AUTH_SECRET)
    .update(`isupply-rate-limit-v1\0${kind}\0${value}`)
    .digest("hex");
}

type CounterRow = { count: number; retryAfter: number };

async function consumeCounter(
  scope: string,
  identityHash: string,
  policy: RateLimitPolicy,
): Promise<CounterRow> {
  if (!/^[a-z0-9:_-]{1,80}$/.test(scope)) throw new Error("Invalid rate-limit scope");
  if (!Number.isSafeInteger(policy.limit) || policy.limit < 1) {
    throw new Error("Invalid rate-limit count");
  }
  if (!Number.isSafeInteger(policy.windowSeconds) || policy.windowSeconds < 1) {
    throw new Error("Invalid rate-limit window");
  }

  const [row] = await sql<CounterRow[]>`
    INSERT INTO request_rate_limits
      (scope, identity_hash, window_started_at, request_count, expires_at)
    VALUES
      (${scope}, ${identityHash}, now(), 1, now() + interval '30 days')
    ON CONFLICT (scope, identity_hash) DO UPDATE
    SET request_count = CASE
          WHEN request_rate_limits.window_started_at
                 <= now() - make_interval(secs => ${policy.windowSeconds})
            THEN 1
          ELSE request_rate_limits.request_count + 1
        END,
        window_started_at = CASE
          WHEN request_rate_limits.window_started_at
                 <= now() - make_interval(secs => ${policy.windowSeconds})
            THEN now()
          ELSE request_rate_limits.window_started_at
        END,
        expires_at = now() + interval '30 days'
    RETURNING request_count::int AS count,
      greatest(
        1,
        least(
          -- A window's remaining time cannot exceed the window itself, and
          -- without this clamp it can read as more. now() is the transaction's
          -- start time, so two callers racing for one counter each subtract a
          -- different instant: the one whose transaction began earlier reads a
          -- window_started_at written fractionally after it, which is enough
          -- for the ceil below to answer 61 on a 60-second window. Promising a
          -- wait longer than the window is wrong on its own terms, and it is
          -- what made the rate-limit integration test fail at random.
          ${policy.windowSeconds}::int,
          ceil(extract(epoch FROM (
            window_started_at + make_interval(secs => ${policy.windowSeconds}) - now()
          )))::int
        )
      ) AS "retryAfter"
  `;

  // Roughly one percent of caller identities perform indexed expiry cleanup.
  // The HMAC makes this selection unpredictable to callers, and awaiting it is
  // intentional: serverless runtimes may stop as soon as the response leaves.
  if (Number.parseInt(identityHash.slice(0, 2), 16) < 3) {
    await sql`DELETE FROM request_rate_limits WHERE expires_at < now()`;
  }

  return row;
}

export type RateLimitResult = { allowed: boolean; retryAfter: number };

/**
 * One counter for every caller together — for the shared admin password,
 * where no address or account identifies the guesser. Logged when it trips,
 * because it means someone is guessing and every admin is now locked out
 * until the window passes.
 */
export async function consumeGlobalRateLimit(
  scope: string,
  policy: RateLimitPolicy,
): Promise<RateLimitResult> {
  const row = await consumeCounter(scope, rateLimitIdentityHash("account", "global"), policy);
  if (row.count === policy.limit + 1) {
    console.error(`rate limit ${scope}: ${policy.limit} attempts in ${policy.windowSeconds}s from all addresses`);
  }
  return { allowed: row.count <= policy.limit, retryAfter: row.retryAfter };
}

/**
 * Consume the IP counter and, when known, a second account counter. Both are
 * checked so signing in does not let a caller exchange IP abuse for account
 * abuse or vice versa.
 */
export async function consumeRateLimit(
  scope: string,
  policy: RateLimitPolicy,
  options: { headers?: HeaderSource; accountId?: string | null } = {},
): Promise<RateLimitResult> {
  const source = options.headers ?? (await nextHeaders());
  const identities = [rateLimitIdentityHash("ip", clientAddress(source))];
  if (options.accountId) {
    identities.push(rateLimitIdentityHash("account", options.accountId));
  }

  const rows = await Promise.all(
    identities.map((identityHash) => consumeCounter(scope, identityHash, policy)),
  );
  const denied = rows.filter((row) => row.count > policy.limit);
  return {
    allowed: denied.length === 0,
    retryAfter: Math.max(1, ...(denied.length > 0 ? denied : rows).map((row) => row.retryAfter)),
  };
}
