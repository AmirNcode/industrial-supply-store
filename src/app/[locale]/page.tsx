import Link from "next/link";
import { notFound } from "next/navigation";
import { getCategoriesToDepth, type CategoryRow } from "@/db/queries";
import { CategorySidebar } from "@/components/CategorySidebar";
import { ProductIcon } from "@/components/ProductIcon";
import { isLocale, getDict, pick, type Locale } from "@/lib/i18n";
import { categorySpine } from "@/lib/categoryColor";

/** Categories change only when the catalog is reseeded, so cache the page. */
export const revalidate = 3600;

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const l = locale as Locale;
  const t = getDict(l);

  const all = await getCategoriesToDepth(2);
  const tops = all.filter((c) => c.depth === 0);
  const byParent = new Map<number, CategoryRow[]>();
  for (const c of all) {
    if (c.parentId === null) continue;
    if (!byParent.has(c.parentId)) byParent.set(c.parentId, []);
    byParent.get(c.parentId)!.push(c);
  }

  return (
    <div className="flex gap-4 px-3 pt-2">
      <CategorySidebar locale={l} />

      <main className="min-w-0 flex-1">
        <h1 className="mb-3 hidden border-b border-[var(--color-ink)] pb-1 text-[13px] font-bold lg:block">
          {t.allCategories}
        </h1>

        {tops.map((top) => {
          const kids = byParent.get(top.id) ?? [];
          // A depth-1 child that has children of its own becomes a labelled
          // group; one that has none is itself a tile.
          const groups = kids.filter((k) => (byParent.get(k.id) ?? []).length > 0);
          const loose = kids.filter((k) => (byParent.get(k.id) ?? []).length === 0);

          return (
            <section key={top.id} className="mb-6 lg:mb-8">
              <h2 className="mb-3 border-b border-[var(--color-rule)] pb-1">
                <Link
                  href={`/${l}/c/${top.path}`}
                  className="text-[19px] font-bold text-[var(--color-pine)] lg:text-[21px]"
                >
                  {pick(top, "name", l)}
                </Link>
              </h2>

              {loose.length > 0 && <TileGrid locale={l} items={loose} />}

              {groups.map((g) => (
                <div key={g.id} className="mb-5">
                  <h3 className="mb-2 text-[13px] font-bold">
                    <Link href={`/${l}/c/${g.path}`} className="!text-[var(--color-ink)]">
                      {pick(g, "name", l)}
                    </Link>
                  </h3>
                  <TileGrid locale={l} items={byParent.get(g.id) ?? []} />
                </div>
              ))}
            </section>
          );
        })}
      </main>
    </div>
  );
}

function TileGrid({ locale, items }: { locale: Locale; items: CategoryRow[] }) {
  if (items.length === 0) return null;
  return (
    // Four across on a phone, matching the reference app; fixed-width tiles on
    // desktop so a short row does not stretch into oversized squares.
    <ul className="mb-4 grid grid-cols-4 gap-x-2 gap-y-3 sm:grid-cols-6 lg:[grid-template-columns:repeat(auto-fill,92px)]">
      {items.map((c) => (
        <li key={c.id}>
          <Link
            href={`/${locale}/c/${c.path}`}
            prefetch={false}
            className="group block text-center hover:no-underline"
          >
            <span
              className="tile-face mx-auto flex aspect-square w-full items-center justify-center lg:h-[72px] lg:w-[72px]"
              style={{ "--spine": categorySpine(c.path) } as React.CSSProperties}
            >
              <ProductIcon name={c.icon} size={54} className="h-3/5 w-3/5 lg:h-auto lg:w-auto" />
            </span>
            <span className="mt-1 block text-[11px] leading-tight text-[var(--color-ink)] group-hover:text-[var(--color-pine)] group-hover:underline">
              {pick(c, "name", locale)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
