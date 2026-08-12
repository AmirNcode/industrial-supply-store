import Link from "next/link";
import type { CatalogCategoryListRow } from "@/db/familyQueries";
import { getDict, pick, type Locale } from "@/lib/i18n";
import { formatInt } from "@/lib/money";

/** A compact route into every taxonomy node, including branches with no families. */
export function CategoryAdminIndex({
  categories,
  locale,
}: {
  categories: CatalogCategoryListRow[];
  locale: Locale;
}) {
  const t = getDict(locale);

  return (
    <details className="mb-4 border border-[var(--color-rule)] bg-[var(--color-panel-alt)] px-3 py-2">
      <summary className="cursor-pointer text-[12px] font-bold">
        {t.catalogManageCategories}
      </summary>
      <p className="mt-1 text-[11px] text-[var(--color-ink-muted)]">
        {t.catalogManageCategoriesIntro}
      </p>
      <ul className="mt-2 max-h-[360px] overflow-y-auto border-y border-[var(--color-rule-light)] bg-white">
        {categories.map((category) => (
          <li
            key={category.id}
            className="flex items-center gap-2 border-b border-[var(--color-rule-light)] py-1 pe-2 text-[11px] last:border-b-0"
            style={{ paddingInlineStart: `${8 + category.depth * 16}px` }}
          >
            <span className={category.depth === 0 ? "font-bold" : "font-semibold"}>
              {pick(category, "name", locale)}
            </span>
            <span className="tech text-[10px] text-[var(--color-ink-faint)]">
              {formatInt(category.productCount, locale)}
            </span>
            {!category.isVisible && (
              <span className="pill pill-muted">{t.catalogHidden}</span>
            )}
            <Link
              className="ms-auto"
              href={`/${locale}/admin/products/categories/${category.id}`}
            >
              {t.editCategory}
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}
