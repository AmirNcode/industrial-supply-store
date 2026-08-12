import Link from "next/link";
import { notFound } from "next/navigation";
import { getTopCategories, getFeaturedFamilies, type FamilyRow } from "@/db/queries";
import { CategorySidebar } from "@/components/CategorySidebar";
import { CatalogImage } from "@/components/CatalogImage";
import { isLocale, getDict, pick, type Locale } from "@/lib/i18n";
import { categorySpine } from "@/lib/categoryColor";
import { formatInt } from "@/lib/money";

/** Categories change only when the catalog is reseeded, so cache the page. */
export const revalidate = 3600;

/**
 * Five, not the whole subtree.
 *
 * The home page used to print every subcategory under every top-level heading —
 * several screens of tiles that all say "more categories", with the first
 * actual part still two clicks away. A short run of product tiles shows what is
 * actually sold, and "View all" carries anyone who wants the full tree.
 */
const TILES_PER_CATEGORY = 5;

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const l = locale as Locale;
  const t = getDict(l);

  const [tops, featured] = await Promise.all([
    getTopCategories(),
    getFeaturedFamilies(TILES_PER_CATEGORY),
  ]);

  const byRoot = new Map<string, FamilyRow[]>();
  for (const f of featured) {
    if (!byRoot.has(f.rootPath)) byRoot.set(f.rootPath, []);
    byRoot.get(f.rootPath)!.push(f);
  }

  return (
    <div className="flex gap-4 px-3 pt-2">
      <CategorySidebar locale={l} />

      <main className="min-w-0 flex-1">
        <h1 className="mb-3 hidden border-b border-[var(--color-ink)] pb-1 text-[13px] font-bold lg:block">
          {t.allCategories}
        </h1>

        {tops.map((top) => {
          const families = byRoot.get(top.path) ?? [];

          return (
            <section key={top.id} className="mb-6 lg:mb-8">
              {/* baseline alignment, not centre: the heading and the link are
                  five sizes apart and centring leaves the link floating. */}
              <h2 className="mb-3 flex items-center justify-between gap-3 border-b border-[var(--color-rule)] pb-1">
                <span className="flex min-w-0 items-center gap-2">
                  {top.imageUrl && (
                    <CatalogImage
                      imageUrl={top.imageUrl}
                      icon={top.icon}
                      alt=""
                      size={30}
                      className="h-[30px] w-[30px] shrink-0 object-contain"
                    />
                  )}
                  <Link
                    href={`/${l}/c/${top.path}`}
                    className="text-[19px] font-bold text-[var(--color-navy)] lg:text-[21px]"
                  >
                    {pick(top, "name", l)}
                  </Link>
                </span>
                <Link
                  href={`/${l}/c/${top.path}`}
                  prefetch={false}
                  className="shrink-0 text-[12px] font-bold uppercase tracking-[0.06em] text-[var(--color-navy)]"
                >
                  {t.viewAll}
                  {/* The chevron points the way the page reads. */}
                  <span aria-hidden="true" className="ms-1 inline-block rtl:rotate-180">
                    ›
                  </span>
                </Link>
              </h2>

              <FamilyTiles locale={l} spinePath={top.path} items={families} />
            </section>
          );
        })}
      </main>
    </div>
  );
}

function FamilyTiles({
  locale,
  spinePath,
  items,
}: {
  locale: Locale;
  spinePath: string;
  items: FamilyRow[];
}) {
  const t = getDict(locale);
  if (items.length === 0) return null;

  return (
    // Three across on a phone; on desktop a fixed tile width so a category with
    // two families does not stretch them into billboards.
    <ul className="grid grid-cols-3 gap-x-3 gap-y-4 sm:grid-cols-5 lg:[grid-template-columns:repeat(auto-fill,124px)]">
      {items.map((f) => (
        <li key={f.id}>
          <Link
            href={`/${locale}/f/${f.slug}`}
            prefetch={false}
            className="group block text-center hover:no-underline"
          >
            <span
              // The spine colour is the top-level category's, so a tile still
              // reads as belonging to the section it sits under.
              className="tile-face mx-auto flex aspect-square w-full items-center justify-center lg:h-[92px] lg:w-[92px]"
              style={{ "--spine": categorySpine(spinePath) } as React.CSSProperties}
            >
              <CatalogImage
                imageUrl={f.imageUrl}
                icon={f.icon}
                alt={pick(f, "name", locale)}
                size={66}
                className="h-3/5 w-3/5 object-contain lg:h-[66px] lg:w-[66px]"
              />
            </span>
            <span className="mt-1 block text-[11.5px] font-semibold leading-tight text-[var(--color-ink)] group-hover:text-[var(--color-navy)] group-hover:underline">
              {pick(f, "name", locale)}
            </span>
            <span className="mt-0.5 block text-[10.5px] leading-tight text-[var(--color-ink-faint)]">
              <span className="tech">{formatInt(f.productCount, locale)}</span>{" "}
              {t.productsLower}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
