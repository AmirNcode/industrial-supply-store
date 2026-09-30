import { NextResponse, type NextRequest } from "next/server";
import { actionBodyAllowed } from "./lib/actionBodyLimit";

/**
 * Caps Server Action bodies by page before Next buffers them
 * (`lib/actionBodyLimit.ts`, review finding M-16). Runs only for requests
 * carrying the `Next-Action` header, so ordinary page views never invoke it.
 */
export function proxy(request: NextRequest) {
  if (request.method === "POST" && !actionBodyAllowed(request.nextUrl.pathname, request.headers.get("content-length"))) {
    return new NextResponse("Request body too large", { status: 413 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: [{ source: "/:path*", has: [{ type: "header", key: "next-action" }] }],
};
