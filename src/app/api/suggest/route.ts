import { NextResponse } from "next/server";
import { suggest } from "@/db/queries";
import { RATE_LIMITS, consumeRateLimit } from "@/lib/rateLimit";
import { REQUEST_LIMITS, boundedString } from "@/lib/requestLimits";

export async function GET(request: Request) {
  const submitted = new URL(request.url).searchParams.get("q");
  const q = boundedString(submitted, REQUEST_LIMITS.suggestionChars, { allowEmpty: true });
  if (q === null) return NextResponse.json({ error: "query too large" }, { status: 400 });
  if (q.trim().length < 2) return NextResponse.json([]);

  const limit = await consumeRateLimit("suggest:read", RATE_LIMITS.suggest, {
    headers: request.headers,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "rate limit" },
      { status: 429, headers: { "retry-after": String(limit.retryAfter) } },
    );
  }
  const results = await suggest(q, 6);
  return NextResponse.json(results, {
    // Repeated keystrokes over the same prefix are common; a short private
    // cache absorbs them without going stale in a way anyone would notice.
    headers: { "cache-control": "private, max-age=30" },
  });
}

/** Route handlers do not inherit the layout ceiling; same reasoning as there. */
export const maxDuration = 60;
