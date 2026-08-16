import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getCategoryByPath,
  getChildren,
  getAncestors,
  getFamiliesInSubtree,
  type FamilyRow,
} from "@/db/queries";
import { CategorySidebar } from "@/components/CategorySidebar";
import { CatalogImage } from "@/components/CatalogImage";
import { isLocale, getDict, pick, type Locale } from "@/lib/i18n";
import { categorySpine } from "@/lib/categoryColor";
import { formatInt } from "@/lib/money";
import { CategoryHeader } from "./CategoryHeader";

export const revalidate = 3600;

/**
 * Empty on purpose: prerender nothing, cache everything.
 *
 * What matters is that this function *exists*. A dynamic segment with no
 * `generateStaticParams` at all is treated as fully dynamic — served
 * `no-store`, re-rendered on every request, with the `revalidate` above
 * ignored, which is what the production logs were showing. Declaring it, even
 * returning nothing, opts the route into the static path; `dynamicParams`
 * (on by default) then generates each category on its first request and caches
 * it for an hour.
 *
 * Returning the actual categories is the obvious version and it broke the
 * build. Vercel builds this project in `iad1` while the database is in
 * `eu-central-1`, so every query at build time is a transatlantic round trip,
 * and the build machine runs a single worker. Twenty-six top-level categories
 * across two locales is fifty-two extra pages of that; several blew past
 * Next's 60-second per-page ceiling and the pooler eventually dropped the
 * connection mid-render. One visitor paying for one render, once an hour, is
 * the cheaper trade — and it costs the build nothing.
 */
export async function generateStaticParams() {
  return [];
}

/**
 * The category view, and the only one of the two that is cacheable.
 *
 * It reads no `searchParams`, and that is the whole point rather than an
 * accident. Awaiting `searchParams` in a route without Cache Components sets
 * the render's revalidate to 0 — Next's own prerenderer throws to interrupt
 * static generation — so the `?view=list` this page used to read was silently
 * turning the most-visited route on the site into a full render per request,
 * `revalidate = 3600` above notwithstanding. Production logs showed a 100%
 * cache miss rate.
 *
 * The SKU list moved to `./list` for that reason. It genuinely needs a page
 * number, so it stays dynamic; this page is now served from the CDN.
 */
export default async function CategoryPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string[] }>;
}) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const l = locale as Locale;
  const t = getDict(l);

  const path = slug.join("/");
  const category = await getCategoryByPath(path);
  if (!category) notFound();

  const [children, ancestors, families] = await Promise.all([
    getChildren(category.id),
    getAncestors(category.path),
    getFamiliesInSubtree(category.path),
  ]);

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
        <CategoryHeader
          locale={l}
          category={category}
          ancestors={ancestors}
          view="categories"
        />

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
      </main>
    </div>
  );
}
