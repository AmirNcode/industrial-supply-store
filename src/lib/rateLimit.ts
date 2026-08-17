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
} as const satisfies Record<string, RateLimitPolicy>;

type HeaderSource = Pick<Headers, "get">;

/**
 * Vercel overwrites X-Forwarded-For with the public client address. Its
 * Vercel-specific twin is checked first so a proxy in front of Vercel cannot
 * replace the value the platform supplied. Self-hosters must likewise let
 * only their trusted reverse proxy set these headers.
 */
export function clientAddress(source: HeaderSource): string {
  for (const name of ["x-vercel-forwarded-for", "x-forwarded-for", "x-real-ip"]) {
    const candidate = source.get(name)?.split(",", 1)[0]?.trim();
    if (candidate && isIP(candidate)) return candidate;
  }
  return "unknown";
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
        ceil(extract(epoch FROM (
          window_started_at + make_interval(secs => ${policy.windowSeconds}) - now()
        )))::int
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
