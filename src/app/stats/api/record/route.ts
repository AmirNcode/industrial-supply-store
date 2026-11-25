import { clientAddress } from "@/lib/rateLimit";
import {
  STATS_MAX_RECORD_BYTES,
  STATS_ORIGIN,
  scrubRecorderUpload,
  statsForwardHeaders,
} from "@/lib/statsTracker";

/**
 * Session replay and heatmap uploads, passed on to the stats server the same
 * way as `../send` (allow-listed headers, never cookies), after
 * `scrubRecorderUpload` has reduced pay links and order references in them
 * to their shape.
 */
const STATS_TIMEOUT_MS = 5000;

export const maxDuration = 10;

export async function POST(request: Request) {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > STATS_MAX_RECORD_BYTES) return new Response(null, { status: 413 });
  const raw = await request.text();
  if (raw.length > STATS_MAX_RECORD_BYTES) return new Response(null, { status: 413 });
  const body = scrubRecorderUpload(raw);
  if (body === null) return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });

  try {
    const upstream = await fetch(`${STATS_ORIGIN}/api/record`, {
      method: "POST",
      headers: statsForwardHeaders(request.headers, clientAddress(request.headers)),
      body,
      signal: AbortSignal.timeout(STATS_TIMEOUT_MS),
      cache: "no-store",
    });
    // The recorder ignores the answer; only the status is passed on.
    return new Response(null, {
      status: upstream.ok ? 204 : upstream.status === 400 ? 400 : 204,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  }
}
