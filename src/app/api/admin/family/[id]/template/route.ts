import { isAdmin } from "@/lib/admin";
import { getFamilyForImport, getProductsForExport, exportRow } from "@/db/importQueries";
import { columnsFor, toCsv, csvAttachment } from "@/lib/importCsv";

/**
 * A blank-but-shaped file for a family: the exact columns an upload must have,
 * with a few of the family's real products as worked examples so the format of
 * each column is obvious rather than described.
 *
 * Not gated on DEMO_MODE. The demo page being publicly readable is a decision
 * about an inbox of generated data; handing out the catalog is a different
 * decision, and this route makes the stricter one.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // 404 rather than 401 so the route does not confirm the family exists to
  // someone who is not signed in.
  if (!(await isAdmin())) return new Response("Not found", { status: 404 });

  const { id } = await params;
  const family = await getFamilyForImport(Number(id));
  if (!family) return new Response("Not found", { status: 404 });

  const columns = columnsFor(family.defs);
  const samples = (await getProductsForExport(family.id)).slice(0, 3);
  const records =
    samples.length > 0
      ? samples.map((p) => exportRow(p, family.defs))
      : [columns.map(() => "")];

  return csvAttachment(toCsv(columns, records), `${family.slug}-template.csv`);
}
