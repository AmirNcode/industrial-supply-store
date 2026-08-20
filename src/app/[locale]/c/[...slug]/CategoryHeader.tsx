import { Breadcrumb } from "@/components/Breadcrumb";
import { CatalogImage } from "@/components/CatalogImage";
import { ViewAsToggle } from "@/components/ViewAsToggle";
import { CatalogCallout } from "@/components/CatalogCallout";
import { getDict, pick, type Locale } from "@/lib/i18n";
import { formatInt } from "@/lib/money";
import type { CategoryDetailRow, CategoryRow } from "@/db/queries";

/**
 * Breadcrumb, title and the view toggle — everything both category views share.
 *
 * Extracted when the "list of products" view moved to its own route. The two
 * pages have to look identical down to the pixel above the fold, and the toggle
 * has to point at the other one from either side, so this is the one copy.
 */
export function CategoryHeader({
  locale,
  category,
  ancestors,
  view,
}: {
  locale: Locale;
  category: CategoryDetailRow;
  ancestors: CategoryRow[];
  view: "categories" | "list";
}) {
  const t = getDict(locale);

  return (
    <>
      <Breadcrumb
        locale={locale}
        trail={ancestors}
        current={pick(category, "name", locale)}
        count={category.productCount}
        countLabel={`${formatInt(category.productCount, locale)} ${t.products}`}
      />

      <div className="mb-4 flex items-center justify-between gap-3 border-b border-[var(--color-rule)] pb-1">
        <span className="flex min-w-0 items-center gap-2">
          {category.imageUrl && (
            <CatalogImage
              imageUrl={category.imageUrl}
              icon={category.icon}
              alt=""
              size={34}
              className="h-[34px] w-[34px] shrink-0 object-contain"
              eager
            />
          )}
          <h1 className="text-[19px] font-bold text-[var(--color-navy)] lg:text-[21px]">
            {pick(category, "name", locale)}
          </h1>
        </span>
        {category.productCount > 0 && (
          <ViewAsToggle
            locale={locale}
            categoriesHref={`/${locale}/c/${category.path}`}
            listHref={`/${locale}/l/${category.path}`}
            current={view}
          />
        )}
      </div>

      {/* Under the title rather than above it, as the reference site places it:
          the description explains the heading it follows. The family page keeps
          its callout above its own heading because there the heading lives
          inside the table section, not at the top of the page. */}
      <CatalogCallout locale={locale} entity={category} />
    </>
  );
}
