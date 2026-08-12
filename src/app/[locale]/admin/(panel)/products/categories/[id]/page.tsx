import Link from "next/link";
import { notFound } from "next/navigation";
import { getCatalogCategoryEditor } from "@/db/familyQueries";
import { DEMO_MODE } from "@/lib/demo";
import { getDict, isLocale, pick, type Locale } from "@/lib/i18n";
import { CatalogMediaForm } from "./CatalogMediaForm";

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

  return (
    <>
      <Link className="mb-2 inline-block text-[11px]" href={`/${l}/admin/products`}>
        ← {t.catalogEditBack}
      </Link>
      <h1 className="mb-1 border-b border-[var(--color-ink)] pb-1 text-[17px] font-bold">
        {t.catalogEditTitle.replace("{category}", currentName)}
      </h1>
      <p className="mb-4 text-[12px] text-[var(--color-ink-muted)]">
        {t.catalogEditIntro}
      </p>

      {DEMO_MODE && (
        <p className="mb-4 border border-[var(--color-warn-line)] bg-[var(--color-warn-soft)] px-3 py-2 text-[12px]">
          {t.importReadOnly}
        </p>
      )}

      <Section title={t.catalogEditCategory}>
        <CatalogMediaForm
          key={`category-${editor.category.id}-${editor.category.imageUrl}-${editor.category.isVisible}`}
          entity={editor.category}
          kind="category"
          locale={l}
          demo={DEMO_MODE}
        />
      </Section>

      {editor.children.length > 0 && (
        <Section title={t.catalogEditSubcategories}>
          {editor.children.map((category) => (
            <CatalogMediaForm
              key={`category-${category.id}-${category.imageUrl}-${category.isVisible}`}
              entity={category}
              kind="category"
              locale={l}
              demo={DEMO_MODE}
            />
          ))}
        </Section>
      )}

      {editor.families.length > 0 && (
        <Section title={t.catalogEditFamilies}>
          {editor.families.map((family) => (
            <div key={family.id} id={`family-${family.id}`} className="scroll-mt-24">
              <CatalogMediaForm
                key={`family-${family.id}-${family.imageUrl}-${family.isVisible}`}
                entity={family}
                kind="family"
                locale={l}
                demo={DEMO_MODE}
              />
            </div>
          ))}
        </Section>
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <h2 className="mb-2 border-b border-[var(--color-rule)] pb-1 text-[14px] font-bold">
        {title}
      </h2>
      <div className="grid gap-2">{children}</div>
    </section>
  );
}
