import Link from "next/link";
import { getTopCategories } from "@/db/queries";
import { getDict, pick, type Locale } from "@/lib/i18n";

/**
 * The persistent left rail. Always the top-level list, never the current
 * subtree — the reference site keeps this stable so the eye learns its position
 * and does not have to re-read it on every navigation.
 */
export async function CategorySidebar({
  locale,
  activePath,
  heading,
}: {
  locale: Locale;
  activePath?: string;
  heading?: string;
}) {
  const t = getDict(locale);
  const all = await getTopCategories();
  const activeRoot = activePath?.split("/")[0];

  // Alphabetical by the displayed name, per locale — a buyer scanning 26 entries
  // for "Sealing" should not have to know the catalog's internal ordering.
  // Intl collation matters here: Persian sorts nothing like code-unit order.
  const collator = new Intl.Collator(locale === "fa" ? "fa" : "en");
  const cats = [...all].sort((a, b) =>
    collator.compare(pick(a, "name", locale), pick(b, "name", locale)),
  );

  return (
    // Hidden below lg: at phone width this rail consumed two thirds of the
    // screen. Mobile reaches the same categories through the on-page grid and
    // the header drawer.
    <nav
      className="hidden shrink-0 border-e border-[var(--color-rule)] pe-3 lg:block"
      style={{ width: 250 }}
    >
      <h2 className="border-b border-[var(--color-ink)] pb-1 mb-1.5 text-[13px] font-bold">
        {heading ?? t.chooseCategory}
      </h2>
      <ul>
        {cats.map((c) => {
          const active = c.slug === activeRoot;
          return (
            <li key={c.id}>
              <Link
                href={`/${locale}/c/${c.path}`}
                prefetch={false}
                className={`block py-[3px] text-[13px] leading-snug ${
                  active
                    ? "font-bold text-[var(--color-catalog-green-dark)]"
                    : "text-[var(--color-catalog-green)]"
                }`}
              >
                {pick(c, "name", locale)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
