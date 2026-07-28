import Link from "next/link";
import { getDict, type Locale } from "@/lib/i18n";
import { SearchBar } from "./SearchBar";
import { CartLink } from "./CartLink";
import { MobileHeader } from "./MobileHeader";

/**
 * Two distinct mastheads rather than one that reflows.
 *
 * The desktop bar is a three-column layout with the wordmark, a centred search
 * and the order links. Squeezing that into 375px is what made the first mobile
 * pass unusable — at phone width the search needs the full row and the nav has
 * to collapse behind a drawer, which is a different structure, not a narrower
 * version of the same one.
 */
export function Header({ locale }: { locale: Locale }) {
  const t = getDict(locale);
  const other: Locale = locale === "fa" ? "en" : "fa";

  return (
    <header className="border-b-2 border-[var(--color-accent-bar)]">
      <MobileHeader locale={locale} />

      <div className="hidden items-start gap-4 px-3 pt-1 pb-2 lg:flex">
        <div className="shrink-0" style={{ width: 262 }}>
          <Link
            href={`/${locale}`}
            className="flex items-center gap-1 text-[10px] font-bold tracking-wide text-[var(--color-catalog-green)] uppercase"
          >
            <span aria-hidden="true">☰</span> {t.browseCatalog}
          </Link>
          <Link href={`/${locale}`} className="block hover:no-underline">
            <span
              className="block whitespace-nowrap font-bold text-[var(--color-catalog-green-dark)] leading-tight"
              style={{
                // Sized to fit the wordmark on one line in both scripts; Persian
                // glyphs are wider at the same nominal size.
                fontSize: locale === "fa" ? 20 : 22,
                letterSpacing: locale === "fa" ? 0 : "-0.02em",
                fontFamily: locale === "fa" ? undefined : "Georgia, 'Times New Roman', serif",
              }}
            >
              {t.brand}
              <sup className="text-[9px] align-super">®</sup>
            </span>
          </Link>
        </div>

        <div className="min-w-0 flex-1 pt-3">
          <SearchBar locale={locale} />
        </div>

        <div className="shrink-0 text-end" style={{ width: 300 }}>
          <div className="flex items-center justify-end gap-2 pt-1 text-[11px] text-[var(--color-ink-muted)]">
            <span className="tech">+98 21 8888 0000</span>
            <span className="text-[var(--color-rule)]">|</span>
            <a href="mailto:sales@parstech.example">{t.emailUs}</a>
            <span className="text-[var(--color-rule)]">|</span>
            <Link href={`/${other}`} lang={other} className="font-bold">
              {other === "fa" ? "فارسی" : "English"}
            </Link>
          </div>
          <div className="flex items-center justify-end gap-4 pt-2">
            <CartLink locale={locale} />
            <Link
              href={`/${locale}/quick-order`}
              className="text-[13px] font-bold uppercase tracking-wide text-[var(--color-catalog-green)]"
            >
              {t.quickOrder}
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}
