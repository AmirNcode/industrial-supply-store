import Link from "next/link";
import { getDict, type Locale } from "@/lib/i18n";
import { SearchBar } from "./SearchBar";
import { LocaleSwitch } from "./LocaleSwitch";
import { CartLink } from "./CartLink";
import { MobileHeader } from "./MobileHeader";

/**
 * Two distinct mastheads rather than one that reflows.
 *
 * The desktop masthead is a branding line above a control row — Catalog,
 * search, then the order and account links. Squeezing that into 375px is what
 * made the first mobile pass unusable — at phone width the search needs the
 * full row and the nav has to collapse behind a drawer, which is a different
 * structure, not a narrower version of the same one.
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

        {/* Branding on its own line, above the controls, so it is present on
            every page rather than only where there was room for it beside the
            search. One line keeps that cheap in vertical space. */}
        <div className="hidden px-4 pt-2 lg:block">
          <Link href={`/${locale}`} className="flex items-center gap-3 hover:no-underline">
            {/* The wordmark is the image now, so `alt` carries the brand name.
                With the text gone this is the only place "TEMEX" exists on the
                page — an empty alt here would erase it for screen readers and
                for anything reading the markup. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/temex-logo-cropped.jpg"
              alt={t.brand}
              width={1908}
              height={543}
              className="block h-[26px] w-auto shrink-0"
            />
            <span className="text-[17px] text-[var(--color-chrome-muted)]">
              {t.tagline}
            </span>
          </Link>
        </div>

        <div className="hidden items-center gap-5 px-4 pt-2 pb-2.5 lg:flex">
          <Link
            href={`/${locale}`}
            className="shrink-0 rounded-[3px] bg-[var(--color-amber)] px-3 py-1.5 text-[12px] font-semibold uppercase tracking-[0.06em] !text-[var(--color-chrome)] hover:no-underline"
          >
            {t.catalogButton}
          </Link>

          {/* Capped rather than filling the bar: a search field the width of a
              desktop window is harder to aim at, not easier. */}
          <div className="min-w-0 max-w-[560px] flex-1">
            <SearchBar locale={locale} />
          </div>

          <div className="ms-auto shrink-0 text-end">
            <div className="flex items-center justify-end gap-3 text-[11px] text-[var(--color-chrome-muted)]">
              <span className="tech">+98 21 8888 0000</span>
              <span className="text-[var(--color-chrome-line)]">|</span>
              <a
                href="mailto:sales@temex.example"
                className="!text-[var(--color-chrome-ink)] hover:!text-white"
              >
                {t.emailUs}
              </a>
              <span className="text-[var(--color-chrome-line)]">|</span>
              <LocaleSwitch
                other={other}
                className="font-bold !text-[var(--color-chrome-ink)] hover:!text-white"
              />
            </div>
            <div className="mt-1.5 flex items-center justify-end gap-4">
              <CartLink locale={locale} />
              <Link
                href={`/${locale}/quick-order`}
                className="text-[12px] font-semibold uppercase tracking-[0.08em] !text-[var(--color-amber-lift)] hover:!text-white"
              >
                {t.quickOrder}
              </Link>
              {/* Unconditional: reading the session here would make every
                  cached catalog page dynamic. /account decides for itself
                  whether to show orders or a sign-in prompt. */}
              <Link
                href={`/${locale}/account`}
                className="text-[12px] font-semibold uppercase tracking-[0.08em] !text-[var(--color-amber-lift)] hover:!text-white"
              >
                {t.account}
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
