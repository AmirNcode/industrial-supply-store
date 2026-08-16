import { NextResponse } from "next/server";
import { addLine, removeLine, getCartCount, getCartQuantities } from "@/lib/cart";

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
  let body: unknown;
  try {
    body = await request.json();
  } catch {
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
  const lineQty = await addLine(id, quantity);
  return NextResponse.json(
    { count: await getCartCount(), productId: id, qty: lineQty },
    { headers: NO_STORE },
  );
}

/** Clears one line, for the × beside the "In Cart" quantity. */
export async function DELETE(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
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
