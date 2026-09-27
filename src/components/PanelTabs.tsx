"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * A panel's tab strip — the admin's and the sales rep portal's.
 *
 * A client component only because a layout is not told the current path, and
 * knowing which tab is current is the whole point — the selected tab drops its
 * bottom border so it runs into the page beneath it.
 *
 * Matched by prefix, so `/admin/products/60/columns` still lights Products.
 * `exact` opts out, for a home tab like `/rep` that every page sits beneath.
 */
export function PanelTabs({
  sections,
}: {
  sections: { href: string; label: string; exact?: boolean }[];
}) {
  const pathname = usePathname();

  return (
    <ul className="admin-tabs-list">
      {sections.map((s) => {
        const current = pathname === s.href || (!s.exact && pathname.startsWith(`${s.href}/`));
        return (
          <li key={s.href}>
            {/* `aria-current` carries the same fact to a screen reader, and the
                CSS keys off it rather than off a class of its own. */}
            <Link
              href={s.href}
              aria-current={current ? "page" : undefined}
              className="admin-tab"
            >
              {s.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
