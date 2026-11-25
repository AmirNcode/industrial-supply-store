import { STATS_ORIGIN, STATS_WEBSITE_ID, recorderSettings } from "@/lib/statsTracker";

/**
 * The recorder's settings (sample rates, masking) as set in Umami under
 * TEMEX → Edit → Replays & Heatmaps. Only this site's ID is answered, so the
 * route cannot be used to read anything else from the stats server.
 *
 * Every visitor's recorder asks once per page load, so the answer is cached
 * at Vercel's edge for five minutes: a settings change takes up to that long
 * to reach visitors, and the function runs a few hundred times a day at most
 * instead of once per page view. A stats server that is off answers "off".
 */
const STATS_TIMEOUT_MS = 3000;

export const maxDuration = 10;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!STATS_WEBSITE_ID || id !== STATS_WEBSITE_ID) return new Response(null, { status: 404 });

  let settings: Record<string, unknown> = { enabled: false };
  let cache = "public, s-maxage=60";
  try {
    const upstream = await fetch(`${STATS_ORIGIN}/api/websites/${STATS_WEBSITE_ID}/recorder`, {
      signal: AbortSignal.timeout(STATS_TIMEOUT_MS),
      cache: "no-store",
    });
    if (upstream.ok) {
      settings = recorderSettings(await upstream.json());
      cache = "public, max-age=0, s-maxage=300, stale-while-revalidate=3600";
    }
  } catch {
    /* off or unreachable: record nothing, ask again in a minute */
  }
  return Response.json(settings, { headers: { "Cache-Control": cache } });
}
