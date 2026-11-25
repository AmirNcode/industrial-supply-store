import { clientAddress } from "@/lib/rateLimit";
import { STATS_ORIGIN, statsForwardHeaders, STATS_MAX_BODY_BYTES } from "@/lib/statsTracker";

/**
 * The tracker's reports, passed on to the stats server.
 *
 * A route handler rather than a rewrite: a rewrite forwards the whole request,
 * cookies included, so every page view sent the visitor's sign-in cookies —
 * admin and customer sessions — to the home server. This sends the report
 * body and an allow-list of headers (`statsForwardHeaders`), nothing else.
 *
 * Statistics are never worth a visitor's wait or an error: a stats server
 * that is off (it is a laptop on mains power) costs one aborted fetch after
 * `STATS_TIMEOUT_MS`, and the browser always gets a quiet answer.
 */
const STATS_TIMEOUT_MS = 3000;

export const maxDuration = 10;

export async function POST(request: Request) {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > STATS_MAX_BODY_BYTES) return new Response(null, { status: 413 });
  const body = await request.text();
  if (body.length > STATS_MAX_BODY_BYTES) return new Response(null, { status: 413 });

  try {
    const upstream = await fetch(`${STATS_ORIGIN}/api/send`, {
      method: "POST",
      headers: statsForwardHeaders(request.headers, clientAddress(request.headers)),
      body,
      signal: AbortSignal.timeout(STATS_TIMEOUT_MS),
      cache: "no-store",
    });
    // Umami answers with a small JSON token the tracker sends back on the
    // next event; nothing else of the upstream response is passed on.
    return new Response(await upstream.text(), {
      status: upstream.ok ? 200 : upstream.status === 400 ? 400 : 204,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch {
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  }
}
