import Link from "next/link";
import { notFound } from "next/navigation";
import { DEMO_MODE } from "@/lib/demo";
import { getFamilyForImport } from "@/db/importQueries";
import { isLocale, getDict, pick, type Locale } from "@/lib/i18n";
import { NewProductForm } from "./NewProductForm";

/**
 * One product, typed in by hand.
 *
 * Scoped to a family because the family is what decides which technical fields
 * exist. Reached from the "Add a product" link on that family's row, so the
 * choice of family is already made by the time this page opens.
 */
export default async function NewProductPage({
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

  return (
    <>
      <Link href={`/${l}/admin/products`} className="text-[11px]">
        ← {t.columnsBack}
      </Link>
      <h1 className="mt-1 mb-1 border-b border-[var(--color-ink)] pb-1 text-[17px] font-bold">
        {t.newProductTitle.replace("{family}", pick(family, "name", l))}
      </h1>
      <p className="mb-4 text-[12px] text-[var(--color-ink-muted)]">{t.newProductIntro}</p>
      <NewProductForm
        familyId={familyId}
        defs={family.defs}
        locale={l}
        demo={DEMO_MODE}
      />
    </>
  );
}
