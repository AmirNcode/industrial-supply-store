import { isAdmin } from "@/lib/admin";
import { getFamilyForImport, getProductsForExport } from "@/db/importQueries";
import type { ProductRecord, ProductTableDef } from "@/lib/productTable";

export type FamilyProductsResponse = {
  defs: ProductTableDef[];
  products: ProductRecord[];
};

/**
 * A family's products for the admin product table, as JSON.
 *
 * Fetched by the table itself rather than rendered with the products page: the
 * workbench changes family in the browser without a server round trip, and
 * the page would otherwise have to ship every family's rows to show one.
 * The same values as the CSV export, from the same query — and the same gate:
 * signed-in staff only, including under DEMO_MODE. The demo's panel pages are
 * public, but this is every row of a family, hidden ones included, with stock
 * and prices, which the demo has no reason to publish.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdmin())) return new Response("Not found", { status: 404 });

  const { id } = await params;
  const family = await getFamilyForImport(Number(id));
  if (!family) return new Response("Not found", { status: 404 });

  const products = await getProductsForExport(family.id);
  const body: FamilyProductsResponse = {
    defs: family.defs.map(({ key, labelEn, labelFa, unit, kind }) => ({ key, labelEn, labelFa, unit, kind })),
    products,
  };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}

/** Route handlers do not inherit the layout ceiling; same reasoning as there. */
export const maxDuration = 60;
