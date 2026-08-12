import { notFound } from "next/navigation";
import { DEMO_MODE } from "@/lib/demo";
import { getFamiliesGrouped } from "@/db/importQueries";
import { getCatalogCategoriesForAdmin, getLeafCategories } from "@/db/familyQueries";
import { isLocale, getDict, type Locale } from "@/lib/i18n";
import { ImportPanel } from "./ImportPanel";
import { NewFamilyForm } from "./NewFamilyForm";
import { CategoryAdminIndex } from "./CategoryAdminIndex";

/**
 * Products: the catalog side of admin. Bulk import today, inventory alongside it.
 *
 * Readable under DEMO_MODE like the rest of the panel, but every write control
 * is disabled — and `assertAdminWrite` refuses the action regardless, so a
 * hand-made POST gets the same answer as a disabled button. The sign-in gate
 * lives in the panel layout.
 */
export default async function AdminProductsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const l = locale as Locale;
  const t = getDict(l);

  const [families, categories, allCategories] = await Promise.all([
    getFamiliesGrouped(),
    getLeafCategories(),
    getCatalogCategoriesForAdmin(),
  ]);

  return (
    <>
      <h1 className="mb-1 border-b border-[var(--color-ink)] pb-1 text-[17px] font-bold">
        {t.products}
      </h1>
      <p className="mb-4 text-[12px] text-[var(--color-ink-muted)]">{t.importIntro}</p>

      {DEMO_MODE && (
        <p className="mb-4 border border-[var(--color-warn-line)] bg-[var(--color-warn-soft)] px-3 py-2 text-[12px]">
          {t.importReadOnly}
        </p>
      )}

      <NewFamilyForm categories={categories} locale={l} demo={DEMO_MODE} />

      <CategoryAdminIndex categories={allCategories} locale={l} />

      <ImportPanel families={families} locale={l} demo={DEMO_MODE} />
    </>
  );
}
