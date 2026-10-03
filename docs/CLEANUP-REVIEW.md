# Cleanup review — 2026-10-03

A full pass over the repository looking for what can be removed or simplified,
judged by one question: **does a coding agent working here pay to read it, and
does it get anything back?** Each numbered item below is meant to be its own
commit (CLAUDE.md: "one change per change").

## Status (2026-10-03, uncommitted)

**Done:** items 1–6, the `.dockerignore` line and design-folder move from 8,
and the `.env.example` gaps from 9. Item 1 went the "keep locally" way at
Amir's request: everything is in `.archive/` (git-ignored, lint-ignored, out of
code search), and `docs/superpowers/` is now ignored so plans written by agent
workflows stay local too. The `NETLIFY` checks and the `vercel.ts` comment from
item 7 are also done; they needed no dashboard change.

**Not done:** item 7's exchange-rate variable and the retired Supabase
variables (waiting on Amir), `venv.txt` (Amir will delete it), `.superpowers/`
(not asked), and the comment trim in 9 (by design, only when a file is next
touched).

**Corrections to the findings below, found while doing them:**

- The vendored Supabase skill (item 6) is the only copy installed, not a
  duplicate of a global one. Kept.
- The M-13 text in `CODE-REVIEW.md` named a by-email admin reset that no longer
  exists; `DEPLOYMENT.md` carries M-13 without that sentence.
- `.env.example` still told people to put live credentials in
  `.env.production.local`, the setup behind the September incident where local
  builds hit the live database. It now says `.env.remote`.
- `npm run lint` read the design prototypes because ESLint does not use
  `.gitignore`. The mobile prototype was never in its ignore list, so lint was
  very likely already failing on this machine before the move (not confirmed by
  a run beforehand; CI never had the folder). The ignore list now covers every
  local-only folder.
- The README's "whole family on one page" measurements were not moved to
  `ARCHITECTURE.md`: family pages have been paged at 100 rows since review M-4,
  so those numbers describe a page that no longer exists.

**Result:** the docs an agent reads on a cold start (CLAUDE.md, README,
ARCHITECTURE, DEPLOYMENT) went from ~106 KB to ~65 KB. A search for
`formatPrice` outside the code went from 39 hits to 4.

Scope: every tracked file (443), the untracked/ignored files on disk, and the
Vercel production environment's variable *names* (no values were read).

## Summary

| # | Finding | Size | Risk to remove | Needs Amir first? |
|---|---|---|---|---|
| 1 | Finished plans, specs, reviews and handoffs still in `docs/` | 865 KB ≈ 215k tokens | none (git keeps them) | yes — delete or archive |
| 2 | `README.md` is stale in a dozen places and repeats the other docs | 26 KB | none | no |
| 3 | Smaller stale passages in `ARCHITECTURE.md`, `DEPLOYMENT.md`, `LOCAL-DEV.md` | ~12 KB removable | none | no |
| 4 | Dead admin screens and the functions only they used | ~1,000 lines | low | no |
| 5 | Three one-shot database scripts; one now re-adds a dropped column | 273 lines, 4 npm commands | low | no |
| 6 | Duplicate and unused files (`assets/`, an unused favicon, sample CSVs) | ~290 KB | none | no |
| 7 | Compatibility code kept alive only by old Vercel settings | ~40 lines | **production breaks if done out of order** | yes — Vercel dashboard |
| 8 | Untracked clutter on disk, one file holding real keys | ~13 MB | none | yes — deletes local files |
| 9 | Small tidy-ups (env example gaps, test script list, stale comments) | small | none | no |

What an agent reads on a cold start today (CLAUDE.md + README + the three docs)
is ~106 KB ≈ 27k tokens. Items 2–3 bring that to roughly 65 KB ≈ 16k tokens.
Item 1 is the bigger win, but it shows up as search noise rather than reading
cost — see below.

---

## 1. Historical documents in the working tree

| Path | Size | What it is |
|---|---|---|
| `docs/superpowers/plans/` (8 files) | 560 KB | implementation plans, all executed and merged |
| `docs/superpowers/specs/` (6 files) | 130 KB | design specs for shipped features |
| `docs/superpowers/reviews/` (3 files) | 97 KB | reviews from 2026-08-05, 08-16, 09-21, all superseded |
| `docs/review/CODE-REVIEW.md` | 100 KB | the 2026-09-28 review, closed 2026-09-30 |
| `docs/TEMEX_Part_Number_Implementation_Handoff/` | 60 KB | the part-number spec, implemented 2026-09-20 |
| `PLAN.md` | 7 KB | the July v1 plan ("Toman", "no buyer accounts", "local only") |

**Why it costs tokens.** Nobody reads these on purpose, but every code search
hits them. The plans contain whole copies of source files *as they were when the
plan was written*. Measured: searching for `formatPrice` finds 47 hits in code
and 39 in these documents; `writeImport` 41 and 23; `currentRep` 15 and 10. An
agent either reads the stale copies or spends tokens filtering them out. The
single largest file, the sales-reps plan, is 300 KB — bigger than any source
file in the project.

**What still matters in them** (move these before removing anything):

- `ARCHITECTURE.md` → "Known gaps" points at
  `docs/superpowers/specs/2026-07-31-accounts-orders-admin-design.md`. The gaps
  are already listed in the paragraph itself; drop the pointer.
- `DEPLOYMENT.md` → "Open before the next deploy" points at
  `CODE-REVIEW.md` M-13 (customer email verification). Copy M-13's two-paragraph
  description into `DEPLOYMENT.md` so the pointer is no longer needed.
- 66 code comments end in a tag like `(review M-17)`. Each comment already
  states its reason; the tag is only a cross-reference. Keep the tags and add one
  line to `ARCHITECTURE.md`: *"`review X-N` tags refer to
  `docs/review/CODE-REVIEW.md`, removed in commit `<sha>`; read it with
  `git show <sha>^:docs/review/CODE-REVIEW.md`."*

**Recommendation:** delete all six from the working tree. Git history is the
archive, and the one-line pointer above makes the review recoverable. If Amir
would rather keep them browsable, the alternative is to move them under
`docs/archive/` and list that folder in a root `.ignore` file, which keeps them
out of agent code search without deleting them. Deleting is cleaner.

---

## 2. `README.md` is stale and duplicates the docs

Checked against the code, these README statements are false today:

| README says | Actually |
|---|---|
| Palette is pine green, masthead near-black `#101d17` | Navy and white since 2026-08-08 (`--color-navy` in `globals.css`) |
| Buyer accounts ❌ out of scope | Customer accounts, sign-up, sign-in, order pages exist |
| `robots.txt` disallows everything | It opens the storefront and disallows only private areas |
| `/` redirects to `/en` | It redirects to `/fa` (`next.config.ts`) |
| `remotePatterns` allows every HTTPS host | Only our own Storage host (closed in review M-5) |
| `/admin` has no audit trail | `audit_log` exists since 2026-09-30 |
| Deploy step 1 is "provision Neon" | The demo is on Supabase; the real target is self-hosted |
| Project is on Next.js 16.3.1 | 16.3.8 |
| Client JS is "four islands" | Dozens of client components (admin, rep, cart, filters) |
| "Admin inbox for submitted RFQs" | Full order queue, invoices, payments, reps |
| Layout: `app/api/` is cart + suggest | Also admin CSV, import, cron, payment proofs, shown-once |

Beyond being wrong, about half the file repeats `DEPLOYMENT.md` (connection
strings, migration commands, env variables) and `ARCHITECTURE.md` (sticky table
head, card layout, data model). Two copies drift; this one already has.

**Recommendation:** cut `README.md` to ~60 lines: what the product is, the four
commands to run it locally, and pointers to the three docs and `CLAUDE.md`.
Before cutting, move the two passages that exist nowhere else and are still
true into `ARCHITECTURE.md`: the family-page size measurements (a cost that
grows with catalog size, which CLAUDE.md asks to keep visible) and the two
seed-generator rules (derived dimensions, derived material properties). Delete
the rest.

---

## 3. Stale passages in the three orientation docs

**`ARCHITECTURE.md`**

- Line 71 says staff have "no audit trail"; line 579 says `audit_log` records
  them. Keep the second.
- Lines 240–242 say `ColumnReview`/`ImportPanel` still carry the hidden-input
  defect. `ImportPanel` is dead code (item 4); `ColumnReview` and
  `MobileColumnReview` still have it. Name those two.
- Lines 292–298 describe `saveFamilyOrder` as how catalog order is saved. That
  function is dead; the workbench saves through `saveAdminTaxonomyChanges`.
- Lines 135–136 say the exchange-rate schedule is Vercel-only. The Docker path
  now has a `scheduler` service.
- "Where things live" omits the cron, payment-proof and shown-once routes.

**`DEPLOYMENT.md`** (~8 KB removable)

- Five paragraphs of per-release instructions (part numbers, sales reps, VAT,
  payment proofs, audit log, and the two 2026-09-30 migrations). All are applied
  to the live database. Keep the general rule that follows them ("Every
  migration must accept the previous release's writes") and delete the rest.
- The "healthy result" sample output shows 13 tables and three ledger entries;
  the current verifier prints more. Replace it with a fresh run or drop it.
- "Moving off Vercel" lists three scheduler options after option 1 was chosen
  and built. Keep the decision and the one-line reason.
- Trap 2 refers to the retained `db:rename-orders:remote` command, which item 5
  removes.

**`LOCAL-DEV.md`**

- The diagram shows `npm run db:column-tiers` (item 5) and step 5 says `/`
  redirects to `/en`.
- About a third of the file is a Docker and Apple Silicon tutorial written for
  Amir, including names of another project's containers on this Mac. Useful to
  him, noise to an agent. Leave it in, but CLAUDE.md should point agents at
  `LOCAL-DEV.md` only for "running the quality gate" and "demo data", not as
  required reading.

---

## 4. Dead code

All verified by searching the whole repository (source, scripts, e2e tests):
each name below appears only at its own definition.

**Three admin components no page renders** (672 lines). The taxonomy
workbench replaced them on 2026-08-22 (`5511c18`). Dead code here has a
measured cost: `ImportPanel.tsx` was still edited twice in September for the
part-number work (`bad5873`, `7cee178`), so agents spent effort keeping a
screen nobody can reach in step with the live one.

- `src/app/[locale]/admin/(panel)/products/ImportPanel.tsx` (545)
- `src/app/[locale]/admin/(panel)/products/CategoryAdminIndex.tsx` (51)
- `src/app/[locale]/admin/(panel)/products/NewFamilyForm.tsx` (76)

**Functions only those components called, or nothing calls** (249 lines incl.
their comments):

| File | Functions |
|---|---|
| `admin/(panel)/products/actions.ts` | `createFamilyAction`, `saveFamilyOrderAction`, types `NewFamilyState`, `FamilyOrderResult` |
| `src/db/familyQueries.ts` | `getCatalogCategoriesForAdmin`, `getLeafCategories`, `getFamilyImpact`, `getCategoryImpact`, `saveFamilyOrder`, types `CatalogCategoryListRow`, `CategoryChoice` |
| `src/db/importQueries.ts` | `getFamiliesGrouped`, type `FamilyListRow` |
| `src/db/inventoryQueries.ts` | `getFamilyInventory` |
| `src/db/queries.ts` | `countProductsInSubtree` |
| `src/db/repOrderQueries.ts` | `repCanSeeOrder` |
| `src/db/audit.ts` | `listAudit` (written for an audit screen that was never built) |
| `src/lib/cart.ts` | `clearCart` |
| `src/lib/filters.ts` | `clearKeyHref` |
| `src/lib/money.ts` | `currencyLabelFor` |
| `src/lib/catalogCallout.ts` | `DIAGRAM_BOX_HEIGHT` |
| `src/db/schema.ts` | `SpecDisplay`, `IGNORED_FIELD` |
| `src/seed/axes.ts` | `ELASTOMERS`, `HARDNESS`, `STRUCTURAL_MATERIALS` |

**29 dictionary entries nobody displays**, each in both languages (~60 lines of
`src/lib/i18n.ts`): `logIn`, `orderHistory`, `filterHelp`, `allOrders`,
`locations`, `invoiceFrom`, `orderPlaced`, `viewOrder`, `importProducts`,
`importIntro`, `reviewShowIn`, `reviewInDetail`, `reviewStartOver`,
`taxonomyChooseNode`, `editCategory`, `catalogManageCategories`,
`catalogManageCategoriesIntro`, `orderSave`, `orderSaved`, `orderFailed`, and
the eight `newFamily*` keys. (Dynamic lookups such as `t[errorKey]` were
checked; their keys appear as string literals and are not in this list.)

Order: delete the three components first, then re-run the search — some types
and dictionary keys only become unused once they are gone. `tsc`, `npm test`
and `npm run build` must stay clean; the build matters because these files sit
in a route folder.

Also: about 110 exported *types and constants* are only used inside their own
file. Dropping the `export` keyword is harmless but saves almost nothing; not
worth a commit on its own.

---

## 5. One-shot database scripts

| Script | npm command(s) | Status |
|---|---|---|
| `scripts/rename-quotes-to-orders.mts` | `db:rename-orders`, `db:rename-orders:remote` | ran in August; `DEPLOYMENT.md` trap 0 says never to replay pre-baseline scripts |
| `scripts/add-catalog-media.mts` | `db:catalog-media` | pre-baseline, columns exist everywhere |
| `scripts/add-column-tiers.mts` | `db:column-tiers` | **harmful now**: it re-adds `spec_defs.display` and its check constraint, which migration `20260930130000` deliberately dropped |

Remove all three and their four npm commands. `scripts/verify-remote.mts` line
115 tells the operator to run `db:rename-orders:remote` if a `quotes` table
exists; change it to "stop — this database predates the baseline" (which is
what `DEPLOYMENT.md` already says to do).

Also in `package.json`: `db:reset` is an alias of `db:bootstrap:local`; keep one.
`test:db` chains six near-identical commands; one
`node --test --test-concurrency=1 src/db/*.integration.test.ts` does the same
and picks up new test files automatically.

---

## 6. Duplicate and unused files

- **`assets/`** (4 files, 232 KB). Nothing references it. Two files are
  byte-identical copies of files in `public/`; the two JPEGs are the originals
  that were shrunk on 2026-10-03. Delete the folder; if the originals are wanted
  as brand masters, keep them outside the repo.
- **`public/temex-favicon.svg`**. Unused: the site icon is `src/app/icon.svg`,
  an identical file that Next serves automatically.
- **`products/`** (2 supplier CSVs, 55 KB). Referenced only by the part-number
  handoff in item 1. The test fixture the unit tests use is a separate file
  (`src/lib/fixtures/gate-valve-sample.csv`). Delete, or move beside that
  fixture if they are wanted for manual import testing.
- **`.agents/skills/supabase/` + `.claude/skills/supabase` + `skills-lock.json`**.
  A copy of Supabase's agent skill vendored in July. The same skill is
  installed globally, so agents may see it twice. Low priority; remove if the
  global one is the one in use.

---

## 7. Compatibility code kept alive by old Vercel settings

Reading the production variable names showed two things the code still
depends on:

**The exchange-rate fallback is set in the old unit.** Production has
`USD_TO_TOMAN`, not `USD_TO_RIAL`. The code (`src/lib/fxRate.ts`, `fx.ts`)
still accepts the Toman variable and multiplies by ten, so this works — but it
means the "legacy" path is the live one, and CI (`.github/workflows/ci.yml`)
also still sets `USD_TO_TOMAN`. The value is only used before the first market
reading, so the stakes are low, but removing the fallback before changing
Vercel would leave production with no fallback rate. Safe order: Amir adds
`USD_TO_RIAL` (the Toman value × 10) in Vercel and deletes `USD_TO_TOMAN`;
then the code and CI drop the Toman branch.

**The retired Supabase project's integration variables are still in
production**: `POSTGRES_URL`, `POSTGRES_PRISMA_URL`, `POSTGRES_URL_NON_POOLING`,
`POSTGRES_HOST`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DATABASE`,
`SUPABASE_JWT_SECRET`, `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
`DEPLOYMENT.md` trap 7 records that one of them already failed a deploy. The
only code that reads any of them is a guarded fallback in `src/db/index.ts`
(line 87), which the guard makes inert. After they are removed from Vercel, that
fallback and the comment explaining it can go.

**`NETLIFY` checks** in `next.config.ts` and `src/db/index.ts`.
`DEPLOYMENT.md` says this is not a Netlify project and the real target is
self-hosted. Remove with the README cut.

Also stale: the `vercel.ts` comment says `fra1` "assumes a Neon project".

---

## 8. Untracked clutter on disk

None of this is in git, but it sits in the project folder where agents list
and open files.

| Path | Size | Note |
|---|---|---|
| `venv.txt` | 4 KB | a `vercel env pull` — **real production keys in plain text**. Delete it. |
| `docs/design_handoff_admin_products_mobile/`, `docs/design_handoff_admin_products_taxonomy/`, `docs/admin-products-page-redesign-handoff/` | 7.3 MB | design prototypes for screens that have shipped; they sit inside `docs/`, so every `ls docs` shows them |
| `.superpowers/sdd/` | 736 KB | July–August subagent briefs, reports and diffs |
| `other_ignore/` | 1.5 MB | includes `HANDOFF.md` (2026-09-03, stale) and release backups |
| `playwright-report/`, `test-results/` | 0.6 MB | regenerated by every test run |

Recommendation: delete `venv.txt` now; move the three design folders and
`.superpowers/` into `other_ignore/` (or delete them); keep `other_ignore/`'s
release backups if they are the only copy.

The uncommitted `.gitignore` change (ignoring the mobile design folder) is not
mirrored in `.dockerignore`, so a Docker build would send that 3.2 MB folder
into the build context. Add the same line there.

`.env.local` is the old `vercel env pull` for the retired scratch project and
includes its service-role key. Local development reads it (Storage uploads go
to the scratch project). Not a cleanup item by itself, but worth knowing when
item 7 retires that project.

---

## 9. Small tidy-ups

- `.env.example` is missing two variables the code reads and `DEPLOYMENT.md`
  documents: `TRUSTED_PROXY_HEADER` and `SUPABASE_PAYMENT_PROOF_BUCKET`.
- 50 code comments narrate history ("this used to…", with dates). Most carry a
  trap worth keeping. When a file is next edited for another reason, shorten the
  story to the rule it taught; do not do a sweep — it is a lot of diff for little
  saving, and the house style asks for *why*-comments.

---

## Reviewed and deliberately left alone

- **`globals.css`** (106 KB). Only three class names looked unused, and those are
  built dynamically (`is-${tone}`). The size is real styling, not dead rules.
- **Comment density** (20% of source). Matches CLAUDE.md's "comments explain
  why"; see item 9 for the only trim worth making.
- **Five HMAC sign/verify modules** (`sessionToken`, `repSessionToken`,
  `adminSessionToken`, `importUploadToken`, `deviceMark`) repeat ~10 lines each.
  A shared helper would save ~40 lines in security code that is tested and
  intentionally kept separate ("three auth systems that share nothing"). Not
  worth the risk.
- **Drizzle table exports** in `schema.ts` that no query imports — `drizzle-kit
  push` needs them.
- **The four cart sync components** — two kinds of sync are needed by design.
- **`src/seed/taxonomy.ts`** (112 KB) — generator data, read only by the seeder.
- **No `TODO`/`FIXME` markers** exist anywhere in the code.

## Suggested commit order

1. Item 4 (dead code), then re-check `i18n.ts` and types.
2. Item 5 (scripts + `package.json` + `verify-remote.mts` message).
3. Item 6 (files).
4. Items 2–3 (docs), including moving the M-13 text and adding the review-tag
   pointer.
5. Item 1 (remove historical docs) — after 4, so the pointer can name the commit.
6. Item 7 code changes — only after Amir has changed the Vercel variables.
7. Item 9.

Item 8 is local-only and needs no commit except the `.dockerignore` line.
