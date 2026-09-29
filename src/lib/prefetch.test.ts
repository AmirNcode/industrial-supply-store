import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The links on every public page do not prefetch.
 *
 * A default `<Link>` renders its target on the server the moment it scrolls
 * into view: the whole page for a cached catalog route, the layout (and its
 * database query) for a dynamic one. In the site chrome that multiplied every
 * page view, and the home page's category titles regenerated every stale
 * category page at once — the bursts behind production's pooler exhaustion
 * (review finding H-2). Nothing on screen shows a prefetch, so it is checked
 * here, from the source.
 */
const FILES = [
  "src/components/Header.tsx",
  "src/components/MobileHeader.tsx",
  "src/components/Footer.tsx",
  "src/components/CartLink.tsx",
  "src/components/LocaleSwitch.tsx",
  "src/components/CategorySidebar.tsx",
  "src/components/Breadcrumb.tsx",
  "src/app/[locale]/page.tsx",
  "src/app/[locale]/c/[...slug]/page.tsx",
];

test("site chrome and catalog links are prefetch={false}", () => {
  for (const file of FILES) {
    const source = readFileSync(join(process.cwd(), file), "utf8");
    const links = source.match(/<Link\b[^>]*>/g) ?? [];
    assert.ok(links.length > 0, `${file} has no links; update this list`);
    for (const link of links) {
      assert.match(link, /prefetch=\{false\}/, `${file}: ${link.replace(/\s+/g, " ").slice(0, 80)}`);
    }
  }
});
