import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Every admin page checks the session itself, before it reads anything.
 *
 * The panel layout's check does not stop a page from rendering: Next runs the
 * page independently and streams its output inside the layout's 307, which is
 * how the whole admin panel leaked to anonymous requests until 2026-09-29
 * (`lib/admin.ts`). A new page that forgets `requireAdmin` reopens that, and
 * nothing on screen shows it — a browser follows the redirect — so it is
 * checked here, from the source.
 */
const PANEL = join(process.cwd(), "src", "app", "[locale]", "admin", "(panel)");

function pagesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return pagesUnder(path);
    return entry.name === "page.tsx" ? [path] : [];
  });
}

test("every admin panel page calls requireAdmin before it awaits anything else", () => {
  const pages = pagesUnder(PANEL);
  assert.ok(pages.length >= 10, `expected the admin panel pages, found ${pages.length}`);
  for (const file of pages) {
    const source = readFileSync(file, "utf8");
    const start = source.indexOf("export default async function");
    assert.notEqual(start, -1, `${file} has no async default export`);
    const body = source.slice(start);
    const gate = body.indexOf("await requireAdmin(");
    assert.notEqual(gate, -1, `${file} does not call requireAdmin`);
    // Reading the route's own params is the one await allowed first: the
    // locale is what the gate redirects with. Anything else awaited before
    // the gate is work a stranger's request would trigger.
    const earlier = (body.slice(0, gate).match(/await\s+(?!params\b)[\w.]+/g) ?? []).map((hit) =>
      hit.replace(/^await\s+/, ""),
    );
    assert.deepEqual(earlier, [], `${file} awaits ${earlier.join(", ")} before requireAdmin`);
  }
});
