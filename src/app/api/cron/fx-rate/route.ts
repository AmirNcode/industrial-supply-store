import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cronAuth";
import { refreshMarketRate } from "@/lib/fxMarketUpdate";

const NO_STORE = { "cache-control": "no-store" };

/**
 * The evening exchange-rate job.
 *
 * Called once a day by the Vercel cron in `vercel.ts`. Nothing here is
 * Vercel-specific: any scheduler that sends the same bearer header can call
 * it, which is what a self-hosted deployment will have to arrange.
 *
 * A refused reading answers 502 so the scheduler's own log marks the run as
 * failed; the site meanwhile keeps its last good rate.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  const result = await refreshMarketRate();
  return NextResponse.json(result, { status: result.ok ? 200 : 502, headers: NO_STORE });
}

/** Route handlers do not inherit the layout ceiling; same reasoning as there. */
export const maxDuration = 60;
