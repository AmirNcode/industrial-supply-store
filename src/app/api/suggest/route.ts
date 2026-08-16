import { NextResponse } from "next/server";
import { suggest } from "@/db/queries";

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  if (q.trim().length < 2) return NextResponse.json([]);
  const results = await suggest(q, 6);
  return NextResponse.json(results, {
    // Repeated keystrokes over the same prefix are common; a short private
    // cache absorbs them without going stale in a way anyone would notice.
    headers: { "cache-control": "private, max-age=30" },
  });
}

/** Route handlers do not inherit the layout ceiling; same reasoning as there. */
export const maxDuration = 60;
