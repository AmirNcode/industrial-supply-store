import { isAdmin } from "@/lib/admin";
import { getFamilyForImport, getProductsPage } from "@/db/importQueries";
import { PRODUCT_PAGE_SIZE, type ProductRecord, type ProductTableDef } from "@/lib/productTable";

export type FamilyProductsResponse = {
  defs: ProductTableDef[];
  /** One page, `PRODUCT_PAGE_SIZE` rows at most, in the export's order. */
  products: ProductRecord[];
  page: number;
  /** Every product in the family, for the pager. */
  total: number;
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
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdmin())) return new Response("Not found", { status: 404 });

  const { id } = await params;
  const family = await getFamilyForImport(Number(id));
  if (!family) return new Response("Not found", { status: 404 });

  const raw = new URL(req.url).searchParams.get("page") ?? "0";
  const page = /^\d{1,6}$/.test(raw) ? Number(raw) : 0;
  const { products, total } = await getProductsPage(family.id, page * PRODUCT_PAGE_SIZE, PRODUCT_PAGE_SIZE);
  const body: FamilyProductsResponse = {
    defs: family.defs.map(({ key, labelEn, labelFa, unit, kind }) => ({ key, labelEn, labelFa, unit, kind })),
    products,
    page,
    total,
  };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}

/** Route handlers do not inherit the layout ceiling; same reasoning as there. */
export const maxDuration = 60;
