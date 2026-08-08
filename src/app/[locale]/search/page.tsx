import Link from "next/link";
import { notFound } from "next/navigation";
import { search } from "@/db/queries";
import { CategorySidebar } from "@/components/CategorySidebar";
import { ProductIcon } from "@/components/ProductIcon";
import { isLocale, getDict, pick, type Locale } from "@/lib/i18n";
import { formatInt, formatPrice } from "@/lib/money";
import { getFxRate } from "@/lib/fx";

export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const l = locale as Locale;
  const t = getDict(l);

  const { q = "" } = await searchParams;
  const results = await search(q);
  const rate = await getFxRate();

  return (
    <div className="flex gap-4 px-3 pt-2">
      <CategorySidebar locale={l} />

      <main className="min-w-0 flex-1">
        <h1 className="mb-3 border-b border-[var(--color-ink)] pb-1 text-[13px] font-bold">
          {t.resultsFor} &ldquo;{q}&rdquo;
        </h1>

        {results.total === 0 && (
          <p className="py-6 text-[13px] text-[var(--color-ink-muted)]">{t.noResults}</p>
        )}

        {results.categories.length > 0 && (
          <section className="mb-6">
            <h2 className="mb-2 text-[15px] font-bold">{t.didYouMean}</h2>
            <ul className="flex flex-wrap gap-x-4 gap-y-1">
              {results.categories.map((c) => (
                <li key={c.id} className="text-[13px]">
                  <Link href={`/${l}/c/${c.path}`} prefetch={false}>
                    {pick(c, "name", l)}
                  </Link>{" "}
                  <span className="tech text-[11px] text-[var(--color-ink-faint)]">
                    {formatInt(c.productCount, l)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {results.products.length > 0 && (
          <section className="mb-6">
            <h2 className="mb-2 text-[15px] font-bold">{t.matchingParts}</h2>
            <div className="scroll-x">
              <table className="spec-table">
                <thead>
                  <tr>
                    <th>{t.partNumber}</th>
                    <th>{t.products}</th>
                    <th className="num">{t.price}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {results.products.slice(0, 30).map((p) => (
                    <tr key={p.id}>
                      <td>
                        <span className="tech font-bold text-[var(--color-ink)]">
                          {p.partNumber}
                        </span>
                      </td>
                      <td>{locale === "fa" ? p.familyFa : p.familyEn}</td>
                      <td className="num tech tech-num">{formatPrice(p.priceCents, l, rate)}</td>
                      <td>
                        <Link
                          href={`/${l}/f/${p.familySlug}?pn=${encodeURIComponent(p.partNumber)}`}
                          prefetch={false}
                          className="text-[11px]"
                        >
                          {t.viewAll}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {results.families.length > 0 && (
          <section>
            <h2 className="mb-2 text-[15px] font-bold">{t.products}</h2>
            <ul className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
              {results.families.map((f) => (
                <li key={f.id}>
                  <Link
                    href={`/${l}/f/${f.slug}`}
                    prefetch={false}
                    className="group flex h-full gap-3 border border-[var(--color-rule)] p-3 hover:border-[var(--color-navy)] hover:no-underline"
                  >
                    <span className="shrink-0">
                      <ProductIcon name={f.icon} size={52} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[14px] font-bold text-[var(--color-navy)] group-hover:underline">
                        {pick(f, "name", l)}
                      </span>
                      <span className="mt-1 block text-[12px] leading-snug text-[var(--color-ink-muted)]">
                        {pick(f, "desc", l)}
                      </span>
                      <span className="mt-1.5 block text-[11px] text-[var(--color-ink-faint)]">
                        <span className="tech">{formatInt(f.productCount, l)}</span>{" "}
                        {t.productsLower}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
