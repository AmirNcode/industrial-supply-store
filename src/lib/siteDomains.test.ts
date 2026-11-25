import assert from "node:assert/strict";
import { test } from "node:test";
import { localeUrl, sitemapEntries } from "./siteDomains";

test("both languages live on temex.ir", () => {
  assert.equal(localeUrl("fa"), "https://www.temex.ir/fa");
  assert.equal(localeUrl("en"), "https://www.temex.ir/en");
  assert.equal(localeUrl("fa", "f/gate-valve"), "https://www.temex.ir/fa/f/gate-valve");
  assert.equal(localeUrl("en", "/c/fasteners/bolts"), "https://www.temex.ir/en/c/fasteners/bolts");
});

test("a language's sitemap lists its own pages, each linked to its twin", () => {
  const entries = sitemapEntries("en", { categoryPaths: ["fasteners/bolts"], familySlugs: ["gate-valve"] });
  assert.deepEqual(
    entries.map((e) => e.url),
    [
      "https://www.temex.ir/en",
      "https://www.temex.ir/en/c/fasteners/bolts",
      "https://www.temex.ir/en/f/gate-valve",
    ],
  );
  assert.deepEqual(entries[2].alternates.languages, {
    en: "https://www.temex.ir/en/f/gate-valve",
    fa: "https://www.temex.ir/fa/f/gate-valve",
    "x-default": "https://www.temex.ir/fa/f/gate-valve",
  });
});

test("an empty catalog still lists the home page", () => {
  assert.deepEqual(
    sitemapEntries("fa", { categoryPaths: [], familySlugs: [] }).map((e) => e.url),
    ["https://www.temex.ir/fa"],
  );
});
