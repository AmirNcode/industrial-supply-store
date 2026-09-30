import { NextResponse, type NextRequest } from "next/server";
import { actionBodyAllowed } from "./lib/actionBodyLimit";

/**
 * Caps Server Action bodies by page before Next buffers them
 * (`lib/actionBodyLimit.ts`, review finding M-16). Runs only for requests that
 * can be an action, so ordinary page views never invoke it.
 */
export function proxy(request: NextRequest) {
  if (request.method === "POST" && !actionBodyAllowed(request.nextUrl.pathname, request.headers.get("content-length"))) {
    return new NextResponse("Request body too large", { status: 413 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    { source: "/:path*", has: [{ type: "header", key: "next-action" }] },
    // A form posted before the page's JavaScript runs names its action in the
    // body, not in the header, and Next treats every multipart POST as a
    // possible action. Matching the header alone let anyone skip the limit by
    // leaving it off (fix review, 2026-09-30).
    { source: "/:path*", has: [{ type: "header", key: "content-type", value: "multipart/form-data.*" }] },
  ],
};
