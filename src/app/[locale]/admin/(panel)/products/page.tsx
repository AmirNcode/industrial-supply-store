import { Suspense } from "react";
import { notFound } from "next/navigation";
import { DEMO_MODE } from "@/lib/demo";
import { getAdminTaxonomyNodes } from "@/db/familyQueries";
import { isLocale, getDict, type Locale } from "@/lib/i18n";
import { TaxonomyWorkbench } from "./TaxonomyWorkbench";

/**
 * One hierarchy-aware products workbench: taxonomy, content, order and import.
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

  const nodes = await getAdminTaxonomyNodes();

  return (
    <>
      {DEMO_MODE && (
        <p className="mb-3 border border-[var(--color-warn-line)] bg-[var(--color-warn-soft)] px-3 py-2 text-[12px]">
          {t.importReadOnly}
        </p>
      )}
      <Suspense fallback={<div className="taxonomy-loading">{t.taxonomyLoading}</div>}>
        <TaxonomyWorkbench nodes={nodes} locale={l} demo={DEMO_MODE} />
      </Suspense>
    </>
  );
}
