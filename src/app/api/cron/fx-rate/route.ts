import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cronAuth";
import { refreshMarketRate, type RefreshResult } from "@/lib/fxMarketUpdate";
import { runExpirySweep } from "@/lib/orderFlow";

const NO_STORE = { "cache-control": "no-store" };

/**
 * The evening exchange-rate job.
 *
 * Called once a day by the Vercel cron in `vercel.ts`. Nothing here is
 * Vercel-specific: any scheduler that sends the same bearer header can call
 * it, which is what a self-hosted deployment will have to arrange.
 *
 * It also enforces order deadlines (`runExpirySweep`): a timer cannot be
 * exact on Vercel Hobby's daily cron, but this guarantees lapsed orders are
 * cancelled and their stock released on days nobody opens the site. The sweep
 * runs whatever the rate part did, and a sweep failure is reported in the
 * JSON without turning a good rate update into an error.
 *
 * A refused reading answers 502 so the scheduler's own log marks the run as
 * failed; the site meanwhile keeps its last good rate.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  let result: RefreshResult | { ok: false; reason: "error" };
  try {
    result = await refreshMarketRate();
  } catch (error) {
    console.error("[cron] rate refresh failed", error);
    result = { ok: false, reason: "error" };
  }
  let expiry: { cancelled: number; released: number } | { error: true };
  try {
    const swept = await runExpirySweep({ force: true });
    expiry = { cancelled: swept.cancelled.length, released: swept.released };
  } catch (error) {
    console.error("[cron] expiry sweep failed", error);
    expiry = { error: true };
  }
  return NextResponse.json({ ...result, expiry }, { status: result.ok ? 200 : 502, headers: NO_STORE });
}

/** Route handlers do not inherit the layout ceiling; same reasoning as there. */
export const maxDuration = 60;
