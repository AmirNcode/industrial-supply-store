import Link from "next/link";
import { getDict, type Locale } from "@/lib/i18n";

export function Footer({ locale }: { locale: Locale }) {
  const t = getDict(locale);
  const links = [
    { href: `/${locale}`, label: t.home },
    { href: `/${locale}/quick-order`, label: t.quickOrder },
    { href: `/${locale}/cart`, label: t.cart },
    { href: `/${locale}/track`, label: t.trackOrder },
  ];
  return (
    <footer className="mt-8 border-t border-[var(--color-rule)] bg-white">
      {/* The promise the brand is built on — fast delivery and a money-back
          guarantee — stated once, where it is on every page without competing
          with the catalog for attention. */}
      <div className="border-b border-[var(--color-rule-light)] px-3 py-2 text-[12px] font-semibold text-[var(--color-navy)]">
        {t.brandPromise}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[11px] text-[var(--color-ink-muted)]">
        {links.map((l, i) => (
          <span key={l.href} className="flex items-center gap-3">
            {i > 0 && <span className="text-[var(--color-rule)]">|</span>}
            <Link href={l.href}>{l.label}</Link>
          </span>
        ))}
        <span className="ms-auto">{t.footerNote}</span>
        {/*
          Enamad's trust seal, required before the payment gateway activates.

          It sits at the inline end of the row, which the reading direction
          turns into the right side in English and the left side in Persian —
          no per-locale branch needed.

          Kept close to Enamad's own snippet on purpose, because their check
          reads it:
          - `referrerPolicy="origin"` on both elements is how Enamad knows
            which domain is displaying the seal. `rel` is `noopener` only:
            `noreferrer` would strip exactly that header when someone clicks
            through to verify the certificate.
          - A plain <img>, not next/image. next/image would fetch the logo
            through Vercel's optimizer, so the request would come from Vercel
            with no visitor referrer — and Enamad's server does not answer
            requests from outside Iran at all.
          - `loading="lazy"`: that same server hangs for any visitor outside
            Iran. An eager image would hold the page's load event open until
            the browser gives up on it.
          - Enamad's `alt=''` leaves the link without a name, so the link
            carries the label for screen readers instead.
        */}
        <a
          href="https://trustseal.enamad.ir/?id=7632148&Code=1auDi9cdJK53HcA2WPL2BV02T5Tu4z7N"
          target="_blank"
          rel="noopener"
          referrerPolicy="origin"
          aria-label={t.enamadSeal}
          className="shrink-0"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
          <img
            referrerPolicy="origin"
            src="https://trustseal.enamad.ir/logo.aspx?id=7632148&Code=1auDi9cdJK53HcA2WPL2BV02T5Tu4z7N"
            alt=""
            loading="lazy"
            decoding="async"
            style={{ cursor: "pointer" }}
            {...{ code: "1auDi9cdJK53HcA2WPL2BV02T5Tu4z7N" }}
          />
        </a>
      </div>
      {/* v1 runs on generated data; saying so in the chrome avoids anyone
          mistaking a demo catalog for a real parts reference. */}
      <div className="border-t border-[var(--color-rule-light)] bg-[var(--color-panel-alt)] px-3 py-1.5 text-[10px] text-[var(--color-ink-faint)]">
        {t.seedNotice}
      </div>
    </footer>
  );
}
