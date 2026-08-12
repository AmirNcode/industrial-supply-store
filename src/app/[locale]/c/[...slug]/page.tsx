import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getCategoryByPath,
  getChildren,
  getAncestors,
  getFamiliesInSubtree,
  getProductsInSubtree,
  getSpecDefsForFamilies,
  type FamilyRow,
} from "@/db/queries";
import { CategorySidebar } from "@/components/CategorySidebar";
import { Breadcrumb } from "@/components/Breadcrumb";
import { CatalogImage } from "@/components/CatalogImage";
import { ViewAsToggle } from "@/components/ViewAsToggle";
import { ProductCardList } from "@/components/ProductCardList";
import { isLocale, getDict, pick, type Locale } from "@/lib/i18n";
import { categorySpine } from "@/lib/categoryColor";
import { formatInt } from "@/lib/money";
import { getFxRate } from "@/lib/fx";

export const revalidate = 3600;

const LIST_PAGE_SIZE = 100;

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string[] }>;
  searchParams: Promise<{ view?: string; page?: string }>;
}) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const l = locale as Locale;
  const t = getDict(l);

  const path = slug.join("/");
  const category = await getCategoryByPath(path);
  if (!category) notFound();

  const sp = await searchParams;
  const view = sp.view === "list" ? "list" : "categories";
  const page = Math.max(1, Number(sp.page) || 1);
  const base = `/${l}/c/${path}`;

  const [children, ancestors, families, rate] = await Promise.all([
    getChildren(category.id),
    getAncestors(category.path),
    getFamiliesInSubtree(category.path),
    getFxRate(),
  ]);

  // Only pay for the SKU list when it is the view actually being rendered.
  const listProducts =
    view === "list"
      ? await getProductsInSubtree(
          category.path,
          LIST_PAGE_SIZE,
          (page - 1) * LIST_PAGE_SIZE,
        )
      : [];
  const listPages =
    view === "list" ? Math.ceil(category.productCount / LIST_PAGE_SIZE) : 0;

  // One extra query for the whole page, keyed on the families actually shown.
  const listDefs =
    listProducts.length > 0
      ? await getSpecDefsForFamilies([...new Set(listProducts.map((p) => p.familyId))])
      : undefined;

  // Families are grouped by their declared heading, preserving catalog order.
  const groups: { name: string; items: FamilyRow[] }[] = [];
  for (const f of families) {
    const name = pick(f, "group", l);
    const last = groups[groups.length - 1];
    if (last && last.name === name) last.items.push(f);
    else groups.push({ name, items: [f] });
  }

  return (
    <div className="flex gap-4 px-3 pt-2">
      <CategorySidebar locale={l} activePath={category.path} />

      <main className="min-w-0 flex-1">
        <Breadcrumb
          locale={l}
          trail={ancestors}
          current={pick(category, "name", l)}
          count={category.productCount}
          countLabel={`${formatInt(category.productCount, l)} ${t.products}`}
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
              {pick(category, "name", l)}
            </h1>
          </span>
          {category.productCount > 0 && (
            <ViewAsToggle
              locale={l}
              categoriesHref={base}
              listHref={`${base}?view=list`}
              current={view}
            />
          )}
        </div>

        {view === "list" ? (
          <>
            <ProductCardList
              locale={l}
              products={listProducts}
              defsByFamily={listDefs}
              rate={rate}
            />
            {listPages > 1 && (
              <nav className="mt-4 flex flex-wrap items-center gap-2 text-[13px]">
                {Array.from({ length: listPages }, (_, i) => i + 1)
                  .filter((p) => p === 1 || p === listPages || Math.abs(p - page) <= 2)
                  .map((p, i, arr) => (
                    <span key={p} className="flex items-center gap-2">
                      {i > 0 && arr[i - 1] !== p - 1 && (
                        <span className="text-[var(--color-ink-faint)]">…</span>
                      )}
                      {p === page ? (
                        <span className="tech font-bold">{formatInt(p, l)}</span>
                      ) : (
                        <Link
                          href={`${base}?view=list${p > 1 ? `&page=${p}` : ""}`}
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
          </>
        ) : (
          <>
        {children.length > 0 && (
          <ul className="mb-6 grid grid-cols-4 gap-x-2 gap-y-3 sm:grid-cols-6 lg:[grid-template-columns:repeat(auto-fill,108px)]">
            {children.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/${l}/c/${c.path}`}
                  prefetch={false}
                  className="group block text-center hover:no-underline"
                >
                  <span
                    className="tile-face mx-auto flex aspect-square w-full items-center justify-center lg:h-[84px] lg:w-[84px]"
                    style={{ "--spine": categorySpine(c.path) } as React.CSSProperties}
                  >
                    <CatalogImage
                      imageUrl={c.imageUrl}
                      icon={c.icon}
                      alt={pick(c, "name", l)}
                      size={62}
                      className="h-3/5 w-3/5 object-contain lg:h-[62px] lg:w-[62px]"
                    />
                  </span>
                  <span className="mt-1 block text-[11px] leading-tight group-hover:text-[var(--color-navy)] group-hover:underline">
                    {pick(c, "name", l)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {groups.map((g, gi) => (
          <section key={`${g.name}-${gi}`} className="mb-6">
            {g.name && (
              <h2 className="mb-2 border-b border-[var(--color-rule)] pb-1 text-[16px] font-bold">
                {g.name}
              </h2>
            )}
            <ul className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
              {g.items.map((f) => (
                <li key={f.id}>
                  <Link
                    href={`/${l}/f/${f.slug}`}
                    prefetch={false}
                    className="group flex h-full gap-3 border border-[var(--color-rule)] p-3 hover:border-[var(--color-navy)] hover:no-underline"
                  >
                    <span className="shrink-0 pt-0.5">
                      <CatalogImage
                        imageUrl={f.imageUrl}
                        icon={f.icon}
                        alt={pick(f, "name", l)}
                        size={58}
                        className="h-[58px] w-[58px] object-contain"
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-bold leading-snug text-[var(--color-navy)] group-hover:underline">
                        {pick(f, "name", l)}
                      </span>
                      <span className="mt-1 block text-[12px] leading-snug text-[var(--color-ink-muted)]">
                        {pick(f, "desc", l)}
                      </span>
                      <span className="mt-2 block text-[11px] text-[var(--color-ink-faint)]">
                        <span className="tech">{formatInt(f.productCount, l)}</span>{" "}
                        {t.productsLower}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}

        {children.length === 0 && families.length === 0 && (
          <p className="text-[13px] text-[var(--color-ink-muted)]">{t.noResults}</p>
        )}
          </>
        )}
      </main>
    </div>
  );
}
