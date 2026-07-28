import { NextResponse } from "next/server";
import { addLine, getCartCount } from "@/lib/cart";

/** Cart size for the header badge — see CartBadge for why this is client-fetched. */
export async function GET() {
  return NextResponse.json(
    { count: await getCartCount() },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { productId, qty } = (body ?? {}) as { productId?: unknown; qty?: unknown };
  const id = Number(productId);
  const n = Number(qty);

  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "bad productId" }, { status: 400 });
  }
  const quantity = Number.isFinite(n) ? Math.max(1, Math.min(99999, Math.trunc(n))) : 1;

  await addLine(id, quantity);
  return NextResponse.json({ count: await getCartCount() });
}
