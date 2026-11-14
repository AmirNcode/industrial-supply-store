import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getDict } from "./i18n";
import { SEARCH_BAR_TEXT, textFor } from "./clientText";

/**
 * No browser component a visitor loads imports the dictionary (review R-8).
 *
 * One `getDict` in a "use client" file puts both languages' full text — about
 * 38 KB compressed — into the page's scripts, and nothing on screen shows it,
 * so it is checked from the source. A type-only import is fine: it is erased.
 * The admin panel is left out on purpose; only staff load it.
 */
function clientFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "admin" ? [] : clientFiles(path);
    return /\.tsx?$/.test(entry.name) && !entry.name.includes(".test.") ? [path] : [];
  });
}

test("browser components outside admin take wording as props", () => {
  const offenders = clientFiles(join(process.cwd(), "src"))
    .filter((file) => {
      const source = readFileSync(file, "utf8");
      return (
        /^\s*["']use client["']/.test(source) &&
        /^import (?!type\b)[^;]*from ["'](@\/lib\/i18n|\.\/i18n|@\/lib\/i18nCheckout)["']/m.test(source)
      );
    })
    .map((file) => file.slice(process.cwd().length + 1))
    // Staff-only screens that live outside the admin folder.
    .filter((file) => file !== "src/components/FxRatePanel.tsx");
  assert.deepEqual(offenders, []);
});

test("textFor passes only the keys asked for", () => {
  const picked = textFor(getDict("fa"), SEARCH_BAR_TEXT);
  assert.deepEqual(Object.keys(picked).sort(), [...SEARCH_BAR_TEXT].sort());
  assert.equal(picked.search, getDict("fa").search);
});
