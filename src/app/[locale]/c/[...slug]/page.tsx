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
import { Breadcrumb } from "@/components/Breadcrumb";
import { ProductIcon } from "@/components/ProductIcon";
import { isLocale, getDict, pick, type Locale } from "@/lib/i18n";
import { formatInt } from "@/lib/money";

export const revalidate = 3600;

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
        <Breadcrumb
          locale={l}
          trail={ancestors}
          current={pick(category, "name", l)}
          count={category.productCount}
          countLabel={`${formatInt(category.productCount, l)} ${t.products}`}
        />

        <h1 className="mb-4 border-b border-[var(--color-rule)] pb-1 text-[21px] font-bold text-[var(--color-catalog-green)]">
          {pick(category, "name", l)}
        </h1>

        {children.length > 0 && (
          <ul className="mb-6 flex flex-wrap gap-x-2 gap-y-3">
            {children.map((c) => (
              <li key={c.id} style={{ width: 108 }}>
                <Link
                  href={`/${l}/c/${c.path}`}
                  prefetch={false}
                  className="group block text-center hover:no-underline"
                >
                  <span className="mx-auto flex h-[84px] w-[84px] items-center justify-center border border-[var(--color-rule)] bg-white group-hover:border-[var(--color-catalog-green)]">
                    <ProductIcon name={c.icon} size={62} />
                  </span>
                  <span className="mt-1 block text-[11px] leading-tight group-hover:text-[var(--color-catalog-green)] group-hover:underline">
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
                    className="group flex h-full gap-3 border border-[var(--color-rule)] p-3 hover:border-[var(--color-catalog-green)] hover:no-underline"
                  >
                    <span className="shrink-0 pt-0.5">
                      <ProductIcon name={f.icon} size={58} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-bold leading-snug text-[var(--color-catalog-green)] group-hover:underline">
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
