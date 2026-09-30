import { NextResponse } from "next/server";
import { clearShownOnce } from "@/lib/shownOnce";

/**
 * Forgets the shown-once credential cookie; see `clearShownOnce`. Nothing to
 * guard: the only effect is deleting the caller's own cookie.
 */
export async function DELETE() {
  await clearShownOnce();
  return new NextResponse(null, { status: 204, headers: { "cache-control": "no-store" } });
}
