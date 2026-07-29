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
 *
 * The chrome is near-black pulled toward green so it reads as part of the
 * palette rather than neutral furniture sitting on top of it. The amber rule
 * beneath is the one piece of the original design worth keeping intact.
 */
export function Header({ locale }: { locale: Locale }) {
  const t = getDict(locale);
  const other: Locale = locale === "fa" ? "en" : "fa";

  return (
    <header>
      <div className="bg-[var(--color-chrome)]">
        <MobileHeader locale={locale} />

        <div className="hidden items-center gap-5 px-4 py-2.5 lg:flex">
          <Link
            href={`/${locale}`}
            className="shrink-0 hover:no-underline"
            style={{ width: 236 }}
          >
            <span
              className="block whitespace-nowrap font-bold leading-none text-white"
              style={{
                fontSize: locale === "fa" ? 19 : 20,
                letterSpacing: locale === "fa" ? 0 : "0.02em",
              }}
            >
              {t.brand}
              <sup className="ms-0.5 align-super text-[8px] text-[var(--color-chrome-muted)]">
                ®
              </sup>
            </span>
            <span className="mt-1 block text-[9px] uppercase tracking-[0.22em] text-[var(--color-chrome-muted)]">
              {t.tagline}
            </span>
          </Link>

          <div className="min-w-0 flex-1">
            <SearchBar locale={locale} />
          </div>

          <div className="shrink-0 text-end">
            <div className="flex items-center justify-end gap-3 text-[11px] text-[var(--color-chrome-muted)]">
              <span className="tech">+98 21 8888 0000</span>
              <span className="text-[var(--color-chrome-line)]">|</span>
              <a
                href="mailto:sales@parstech.example"
                className="!text-[var(--color-chrome-ink)] hover:!text-white"
              >
                {t.emailUs}
              </a>
              <span className="text-[var(--color-chrome-line)]">|</span>
              <Link
                href={`/${other}`}
                lang={other}
                className="font-bold !text-[var(--color-chrome-ink)] hover:!text-white"
              >
                {other === "fa" ? "فارسی" : "English"}
              </Link>
            </div>
            <div className="mt-1.5 flex items-center justify-end gap-4">
              <CartLink locale={locale} />
              <Link
                href={`/${locale}/quick-order`}
                className="text-[12px] font-semibold uppercase tracking-[0.08em] !text-[var(--color-amber-lift)] hover:!text-white"
              >
                {t.quickOrder}
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Descended from the reference site's gold rule; a gradient so it reads
          as a deliberate edge rather than a slab of colour. */}
      <div
        className="h-[3px]"
        style={{
          background:
            "linear-gradient(90deg, var(--color-amber) 0%, var(--color-amber-lift) 38%, var(--color-rule) 100%)",
        }}
      />
    </header>
  );
}
