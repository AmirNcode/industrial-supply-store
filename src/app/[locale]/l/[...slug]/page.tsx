import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getCategoryByPath,
  getAncestors,
  getProductsInSubtree,
  getSpecDefsForFamilies,
} from "@/db/queries";
import { CategorySidebar } from "@/components/CategorySidebar";
import { ProductCardList } from "@/components/ProductCardList";
import { isLocale, type Locale } from "@/lib/i18n";
import { formatInt } from "@/lib/money";
import { getFxRate } from "@/lib/fx";
import { CategoryHeader } from "../../c/[...slug]/CategoryHeader";

const LIST_PAGE_SIZE = 100;

/**
 * "View as: list of products" — every SKU under a category, paginated.
 *
 * Its own route rather than `?view=list` on the category page. A page number
 * has to come from the request, and reading it on the shared route made *both*
 * views uncacheable: the category view, which changes only when an
 * administrator edits the catalog, was being rendered from scratch on every
 * visit. Splitting them lets that one be served from the CDN and confines the
 * per-request work to this page, where it is actually needed.
 *
 * `/l/…` rather than `/c/…/list` because a catch-all has to be the last
 * segment of a route, and it follows the `/c/` and `/f/` the catalog already
 * uses.
 *
 * Still paginated at 100, unlike a family page. This spans a whole subtree —
 * 12,948 products at the top of this catalog — which is a different order of
 * magnitude from the largest single family.
 */
export default async function CategoryListPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string[] }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const l = locale as Locale;

  const path = slug.join("/");
  const category = await getCategoryByPath(path);
  if (!category) notFound();

  const sp = await searchParams;
  const pages = Math.max(1, Math.ceil(category.productCount / LIST_PAGE_SIZE));
  const requestedPage = Number(sp.page);
  const page = Number.isSafeInteger(requestedPage)
    ? Math.min(pages, Math.max(1, requestedPage))
    : 1;
  const base = `/${l}/l/${path}`;

  const [ancestors, products, rate] = await Promise.all([
    getAncestors(category.path),
    getProductsInSubtree(category.path, LIST_PAGE_SIZE, (page - 1) * LIST_PAGE_SIZE),
    getFxRate(),
  ]);

  // One extra query for the whole page, keyed on the families actually shown.
  const defs =
    products.length > 0
      ? await getSpecDefsForFamilies([...new Set(products.map((p) => p.familyId))])
      : undefined;

  return (
    <div className="flex gap-4 px-3 pt-2">
      <CategorySidebar locale={l} activePath={category.path} />

      <main className="min-w-0 flex-1">
        <CategoryHeader
          locale={l}
          category={category}
          ancestors={ancestors}
          view="list"
        />

        <ProductCardList locale={l} products={products} defsByFamily={defs} rate={rate} />

        {pages > 1 && (
          <nav className="mt-4 flex flex-wrap items-center gap-2 text-[13px]">
            {Array.from({ length: pages }, (_, i) => i + 1)
              .filter((p) => p === 1 || p === pages || Math.abs(p - page) <= 2)
              .map((p, i, arr) => (
                <span key={p} className="flex items-center gap-2">
                  {i > 0 && arr[i - 1] !== p - 1 && (
                    <span className="text-[var(--color-ink-faint)]">…</span>
                  )}
                  {p === page ? (
                    <span className="tech font-bold">{formatInt(p, l)}</span>
                  ) : (
                    <Link
                      href={p > 1 ? `${base}?page=${p}` : base}
                      prefetch={false}
                      className="tech tap px-1"
                    >
                      {formatInt(p, l)}
                    </Link>
                  )}
                </span>
              ))}
          </nav>
        )}
      </main>
    </div>
  );
}
