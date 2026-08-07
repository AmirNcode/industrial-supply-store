"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { swapLocale, type Locale } from "@/lib/i18n";

/**
 * Switch language without losing the page.
 *
 * The header used to link at `/fa` outright, which threw the reader back to the
 * catalog — worst on the pages where switching is most useful, like a filtered
 * family listing or an invoice.
 *
 * Deliberately built on `usePathname` alone. `useSearchParams` would opt this
 * subtree out of static rendering, and the catalog pages are prerendered with
 * `revalidate 3600`; behind a Suspense boundary they would serve the fallback
 * href in their HTML, which is the very `/fa` this exists to stop — the old bug
 * would simply move into the window before hydration.
 *
 * So the href is correct in the server-rendered HTML, and the query string is
 * carried across on click instead, where `window.location` is unambiguous.
 * That keeps facets, page number, search term and the invoice's chosen
 * currency, and it degrades to a correct plain link if the click handler never
 * runs.
 */
export function LocaleSwitch({ other, className }: { other: Locale; className?: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const href = swapLocale(pathname, other);

  return (
    <Link
      href={href}
      lang={other}
      className={className}
      onClick={(e) => {
        const query = window.location.search;
        if (!query) return; // plain navigation is already right
        // Only intercept an ordinary left click, so open-in-new-tab and the
        // rest keep working off the href above.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        router.push(`${href}${query}`);
      }}
    >
      {other === "fa" ? "فارسی" : "English"}
    </Link>
  );
}
