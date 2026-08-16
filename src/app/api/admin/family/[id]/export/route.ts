import { isAdmin } from "@/lib/admin";
import { getFamilyForImport, getProductsForExport, exportRow } from "@/db/importQueries";
import { columnsFor, toCsv, csvAttachment } from "@/lib/importCsv";

/**
 * Every product in a family, in the same columns the template uses.
 *
 * That shared column set is the whole point: edit the prices in Excel, upload
 * the same file back, and every row matches an existing part number and
 * updates rather than duplicating.
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
  const csv = toCsv(
    columnsFor(family.defs),
    products.map((p) => exportRow(p, family.defs)),
  );
  return csvAttachment(csv, `${family.slug}-products.csv`);
}

/** Route handlers do not inherit the layout ceiling; same reasoning as there. */
export const maxDuration = 60;
