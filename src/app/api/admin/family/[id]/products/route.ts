import { isAdmin } from "@/lib/admin";
import { DEMO_MODE } from "@/lib/demo";
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
 * Readable under DEMO_MODE like the rest of the panel; the save refuses there.
 * The same values as the CSV export, from the same query.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!DEMO_MODE && !(await isAdmin())) return new Response("Not found", { status: 404 });

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
