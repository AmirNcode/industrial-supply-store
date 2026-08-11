import Link from "next/link";
import { notFound } from "next/navigation";
import { DEMO_MODE } from "@/lib/demo";
import { getFamilyForImport } from "@/db/importQueries";
import { getEditableDefs } from "@/db/columnQueries";
import { isLocale, getDict, pick, type Locale } from "@/lib/i18n";
import { ColumnEditor } from "./ColumnEditor";

/**
 * One family's columns.
 *
 * Reachable from the products list. Everything here is display: what a column
 * is called, where it shows, how it sorts. The only thing that touches product
 * data is deleting a column, which the editor says so before doing.
 */
export default async function FamilyColumnsPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();
  const l = locale as Locale;
  const t = getDict(l);

  const familyId = Number(id);
  const family = await getFamilyForImport(familyId);
  if (!family) notFound();

  const defs = await getEditableDefs(familyId);

  return (
    <>
      <Link href={`/${l}/admin/products`} className="text-[11px]">
        ← {t.columnsBack}
      </Link>
      <h1 className="mt-1 mb-1 border-b border-[var(--color-ink)] pb-1 text-[17px] font-bold">
        {t.columnsTitle.replace("{family}", pick(family, "name", l))}
      </h1>
      <p className="mb-4 text-[12px] text-[var(--color-ink-muted)]">{t.columnsIntro}</p>

      <ColumnEditor familyId={familyId} defs={defs} locale={l} demo={DEMO_MODE} />
    </>
  );
}
