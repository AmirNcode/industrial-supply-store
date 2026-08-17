import { NextResponse } from "next/server";
import {
  CartCapacityError,
  addLine,
  removeLine,
  getCartCount,
  getCartQuantities,
} from "@/lib/cart";
import { RATE_LIMITS, consumeRateLimit } from "@/lib/rateLimit";
import {
  REQUEST_LIMITS,
  RequestBodyTooLargeError,
  readJsonWithin,
} from "@/lib/requestLimits";

const NO_STORE = { "cache-control": "no-store" };

/**
 * The whole cart as line quantities, not just the header count.
 *
 * Catalog pages stay statically rendered (see CartLink), so they cannot read
 * the cart cookie themselves. The "In Cart" column is filled from here instead,
 * in one request per navigation rather than one per row.
 */
export async function GET() {
  const [count, qtys] = await Promise.all([getCartCount(), getCartQuantities()]);
  return NextResponse.json({ count, qtys }, { headers: NO_STORE });
}

function parseProductId(v: unknown): number | null {
  const id = Number(v);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function POST(request: Request) {
  const limit = await consumeRateLimit("cart:write", RATE_LIMITS.cartWrite, {
    headers: request.headers,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "rate limit" },
      { status: 429, headers: { ...NO_STORE, "retry-after": String(limit.retryAfter) } },
    );
  }

  let body: unknown;
  try {
    body = await readJsonWithin(request, REQUEST_LIMITS.routeJsonBytes);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: "body too large" }, { status: 413 });
    }
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { productId, qty } = (body ?? {}) as { productId?: unknown; qty?: unknown };
  const id = parseProductId(productId);
  const n = Number(qty);

  if (id === null) {
    return NextResponse.json({ error: "bad productId" }, { status: 400 });
  }
  const quantity = Number.isFinite(n) ? Math.max(1, Math.min(99999, Math.trunc(n))) : 1;

  // The resulting line quantity comes back so the row can show the running
  // total without a second round trip.
  let lineQty: number;
  try {
    lineQty = await addLine(id, quantity);
  } catch (error) {
    if (error instanceof CartCapacityError) {
      return NextResponse.json({ error: "cart full" }, { status: 409, headers: NO_STORE });
    }
    throw error;
  }
  return NextResponse.json(
    { count: await getCartCount(), productId: id, qty: lineQty },
    { headers: NO_STORE },
  );
}

/** Clears one line, for the × beside the "In Cart" quantity. */
export async function DELETE(request: Request) {
  const limit = await consumeRateLimit("cart:write", RATE_LIMITS.cartWrite, {
    headers: request.headers,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "rate limit" },
      { status: 429, headers: { ...NO_STORE, "retry-after": String(limit.retryAfter) } },
    );
  }

  let body: unknown;
  try {
    body = await readJsonWithin(request, REQUEST_LIMITS.routeJsonBytes);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: "body too large" }, { status: 413 });
    }
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const id = parseProductId((body as { productId?: unknown } | null)?.productId);
  if (id === null) {
    return NextResponse.json({ error: "bad productId" }, { status: 400 });
  }

  await removeLine(id);
  return NextResponse.json(
    { count: await getCartCount(), productId: id, qty: 0 },
    { headers: NO_STORE },
  );
}

/** Route handlers do not inherit the layout ceiling; same reasoning as there. */
export const maxDuration = 60;
