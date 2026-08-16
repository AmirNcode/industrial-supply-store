import Link from "next/link";
import { notFound } from "next/navigation";
import { getCatalogCategoryEditor } from "@/db/familyQueries";
import { DEMO_MODE } from "@/lib/demo";
import { getDict, isLocale, pick, type Locale } from "@/lib/i18n";
import { CatalogMediaEditor, type CatalogMediaSection } from "./CatalogMediaEditor";

export default async function CatalogCategoryEditPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();
  const l = locale as Locale;
  const editor = await getCatalogCategoryEditor(Number(id));
  if (!editor) notFound();
  const t = getDict(l);
  const currentName = pick(editor.category, "name", l);

  const sections: CatalogMediaSection[] = [
    { title: t.catalogEditCategory, kind: "category", entities: [editor.category] },
  ];
  if (editor.children.length > 0) {
    sections.push({
      title: t.catalogEditSubcategories,
      kind: "category",
      entities: editor.children,
    });
  }
  if (editor.families.length > 0) {
    sections.push({
      title: t.catalogEditFamilies,
      kind: "family",
      entities: editor.families,
    });
  }

  return (
    <>
      <Link className="mb-2 inline-block text-[11px]" href={`/${l}/admin/products`}>
        ← {t.catalogEditBack}
      </Link>

      {DEMO_MODE && (
        <p className="mb-4 border border-[var(--color-warn-line)] bg-[var(--color-warn-soft)] px-3 py-2 text-[12px]">
          {t.importReadOnly}
        </p>
      )}

      {/* The heading is rendered by the editor because the page's one Save
          button sits beside it, and only the editor knows whether anything on
          the page has been changed yet. */}
      <CatalogMediaEditor
        title={t.catalogEditTitle.replace("{category}", currentName)}
        intro={t.catalogEditIntro}
        sections={sections}
        locale={l}
        demo={DEMO_MODE}
      />
    </>
  );
}
