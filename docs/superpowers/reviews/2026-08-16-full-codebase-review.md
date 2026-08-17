# Full codebase review — 2026-08-16

## Executive summary

The application is functionally coherent and its core pure-logic test suite, TypeScript check, local ARM64 database, and local production build are healthy. The recent category caching and single-markup responsive-table work are effective: warm home/category/list routes are fast locally, search is reasonably fast, and no desktop/mobile overflow or English/Persian rendering failure was observed.

The site still feels sluggish for a concrete reason that is independent of database geography: the largest family route sends and hydrates all 2,400 products at once. It produced a 1.46 MB compressed / 8.93 MB decoded HTML response, about 79,600 DOM nodes, 2,400 quantity controls, 2,400 cart subscriptions, and a roughly 281,000–297,000 px mobile document. Its five-sample median was 422 ms to first byte and 659 ms total on a warm local production server; the next-slowest measured page was search at 85 ms total. Database query time is not the principal cost on this route.

No P0/critical defect was found. Seven P1/high-priority findings should be addressed before treating the application as production-hardened: the unbounded family page, missing abuse controls and input ceilings, an incorrect inventory-shortfall warning, Docker secret/build defects, current production dependency advisories, migration/deployment hazards, and non-idempotent quote submission.

At the time of the review, no application or database data was changed and this report was the only repository change. Subsequent remediation is recorded below; it remains local until explicitly committed or deployed.

## Remediation status

- **P1-01 — completed locally on 2026-08-17; not committed or deployed.** The default family document is bounded to 100 server-filtered rows, progressive expansion is capped at 500, and an explicit no-follow “view all for Find / Print” mode preserves whole-document workflows. One delegated family cart controller replaces per-row client state and cart-store subscriptions. Five warm final samples measured 57.3 ms median TTFB, 69.0 ms median total, and a 93.6 KB compressed response; browser QA measured 3,790 DOM elements and one table controller for the initial 100 rows. Full evidence is attached to P1-01.
- **P1-02 — completed locally on 2026-08-17; not committed or deployed.** Public auth, cart, quick-order, quote, suggestion, tracking, and importer entry points now have explicit rate policies and semantic input ceilings. Counters use an atomic shared Postgres table and HMAC identities. Quick order performs one bounded batch write, carts cap distinct lines, hostile facets/list offsets are bounded, and the 24 MB CSV importer uploads directly to a private Supabase Storage object through a short-lived signed URL. The global Server Action ceiling is 4.25 MB instead of 32 MB. The direct Storage leg was not exercised against production because doing so would create a bucket/object; its claim logic, auth rejection, build, and client/server integration were verified locally/statically.
- **P1-03 — completed locally on 2026-08-17; not committed or deployed.** Shortfalls are reconstructed from pre-hold stock and allocated in order sequence, rather than comparing each line against availability after its own hold. A local transaction-level suite covers sufficient, exact, insufficient, multiple-order, paid, cancelled, and concurrent quote-replay behavior.
- **P1-04 — completed locally on 2026-08-17; not committed or deployed.** Docker excludes every `.env*` variant except the example file. Database and signing values use required BuildKit secret mounts; the signing key is a runtime Compose secret. A clean production image built as `linux/arm64` and passed local runtime smoke checks.
- **P1-05 — completed for the production dependency tree on 2026-08-17; not committed or deployed.** Next is 16.3.1 and Drizzle ORM is 0.45.2; `npm audit --omit=dev` reports zero vulnerabilities. ESLint 9 replaces the removed `next lint` command. The full development tree still reports seven upstream toolchain findings (four moderate, three high) in `drizzle-kit`'s retired development-server dependency and `@vercel/config`'s routing parser; neither chain is installed in the standalone runtime image.
- **P1-06 — completed locally on 2026-08-17; not committed or deployed.** Reviewed forward SQL migrations now use Supabase's applied ledger, a read-only dry-run, a same-day backup/restore acknowledgement for remote writes, and a separately gated zero-table bootstrap. Remote schema push/seed shortcuts were removed. The live read-only dry-run currently shows exactly two pending migrations: order submission idempotency and shared request-rate-limit storage.
- **P1-07 — completed locally on 2026-08-17; not committed or deployed.** A signed one-time key commits to the cart identity, contents, displayed prices, and expiry. A unique database index and cart-row lock make order creation, item snapshots, stock hold, and cart clear one replay-safe transaction; retries return the original reference. The submit UI also prevents repeat clicks, but database uniqueness remains the correctness boundary.

### Current local remediation verification — 2026-08-17

| Check | Result |
| --- | --- |
| `npm test` | Pass — 147/147 tests |
| `npx tsc --noEmit` | Pass |
| `npm run lint` | Pass |
| `npm run test:db:orders` | Pass — concurrent replay plus stock lifecycle |
| `npm run test:db:rate-limits` | Pass — atomic shared-counter concurrency |
| `npm run db:migrate:check` | Pass — local ledger current |
| `npm run db:migrate:check:remote` | Read-only pass — two expected migrations pending; nothing applied |
| `npm audit --omit=dev` | Pass — zero vulnerabilities |
| Full `npm audit` | Seven development-only toolchain findings remain: 4 moderate, 3 high |
| Production build | Pass — Next.js 16.3.1, 36 generated routes/pages |
| ARM64 Docker production image | Pass — `linux/arm64`; clean BuildKit secret path; Compose runtime secret file served the account route |
| Runtime smoke | `/en`, sign-in, quick order, and suggest return 200; oversized cart 413; malformed cart 400; unauthenticated import 403; no runtime errors |
| Supabase Storage import | Not mutated — production bucket creation/upload deliberately left for deployment verification |

## Scope and review basis

- Reviewed the complete current `main` working tree at `6e8e837` (matching `origin/main` at review start), including application code, database schema and SQL, scripts, tests, Docker, Vercel configuration, dependencies, documentation, security, accessibility, and performance.
- Reviewed 137 files under `src/`, all repository scripts, root configuration, and the existing architecture/deployment/review/performance documents.
- Used the existing local PostgreSQL 17 Docker container. It reports native `aarch64`; the `postgres:17-alpine` image reports `linux/arm64`.
- Exercised a local Next.js production build/server with an explicit local `DATABASE_URL` on port 5434. No remote database writes or production mutations were performed.
- Checked representative English and Persian routes at desktop and 390×844 mobile viewports.
- Deliberately excluded Frankfurt-to-Vercel geographic latency from recommendations, as requested. `vercel.ts` already places functions in `fra1`.

## Original review verification summary

| Check | Result |
| --- | --- |
| `npm test` | Pass — 128/128 tests |
| `npx tsc --noEmit` | Pass |
| `npm run lint` | **Fail** — `next lint` is no longer a valid Next 16 command and is treated as a directory named `lint` |
| Production build with explicit local DB and valid build secret | Pass — 35 static pages |
| Negative clean-environment build check with `AUTH_SECRET` empty | Fails during page-data collection, confirming the Docker build dependency |
| `npm audit --omit=dev` | **Fail** — 5 high-severity production-tree advisories |
| Full `npm audit` | **Fail** — 12 total: 8 high, 4 moderate |
| Local database structural verifier | Reports healthy, but misses two classes of real data drift described below |
| Local RLS posture | Enabled on all 12 public tables, no policies; this is the repository's intended REST-deny posture |
| Browser checks | EN/FA and desktop/mobile render without horizontal overflow; no framework error overlay observed |
| Translation diagnostic | 68 Persian-route values remain Latin/English; nearly all are technical codes/dimensions, with at least one descriptive material value that merits translation review |

## Local production performance baseline

Five warm samples were taken against `next start` with the local ARM64 database. Times are medians; payloads are compressed downloads. This is a code-path comparison, not a production-latency claim.

| Route | Median TTFB | Median total | Payload |
| --- | ---: | ---: | ---: |
| `/en` | 6.2 ms | 6.8 ms | 19.6 KB |
| `/en/c/sealing` (ISR hit) | 3.9 ms | 4.1 ms | 11.5 KB |
| `/en/l/sealing?page=1` | 22.1 ms | 30.2 ms | 82.9 KB |
| `/en/search?q=oring` | 82.4 ms | 85.1 ms | 21.3 KB |
| `/api/suggest?q=oring` | 18.4 ms | 18.4 ms | 1.7 KB |
| `/en/f/socket-head-cap-screws` | **422.1 ms** | **658.9 ms** | **1,460.2 KB** |

Largest-family browser measurements:

- 2,400 product rows.
- Approximately 79,585 DOM elements in both locales/layouts.
- Approximately 2,404 inputs and 2,404 buttons.
- 1.46 MB compressed and 8.93 MB decoded HTML.
- Approximately 281,032 px document height in Persian mobile and 296,896 px in the earlier English mobile sample.
- No horizontal overflow at 390 px, so the issue is volume/hydration rather than responsive breakage.
- Each row mounts `AddToCartRow` state and an `InCartQty` external-store subscription. The first cart refresh notifies roughly 2,400 subscribers.

## Findings

Severity convention:

- **P0** — active critical exposure/data loss. None found.
- **P1** — high impact or high likelihood; address first.
- **P2** — material correctness, security, performance, or maintainability issue.
- **P3** — lower-risk improvement or latent issue.

### P1-01 — Largest family pages are unbounded and dominate perceived performance

**Evidence:** `src/app/[locale]/f/[slug]/page.tsx:43-57`, `:78-85`, and `:396-547`; `src/components/AddToCartRow.tsx:14-65`; `src/components/InCartQty.tsx:17-52`; `src/lib/cartClient.ts:22-35` and `:87-95`.

The route intentionally fetches and renders every matching product. On the largest current family that means 2,400 server-rendered rows, 2,400 independently hydrated quantity components, 2,400 cart-store subscriptions, and all collapsed detail markup. The measured response/DOM figures above explain the sluggish feel without invoking database distance. Even after the previous pass removed duplicate desktop/mobile row markup, this page remains orders of magnitude larger than every other route.

**Recommendation:** Make the initial document bounded. Preserve whole-family filtering on the server, but initially render a measured tranche (for example 100–200 rows) and progressively reveal/fetch more. Replace per-row cart islands with one table-level delegated controller/store subscriber. Keep a separate explicit “show all for browser find/print” option if whole-document search is a hard requirement. Target an initial compressed response below 300 KB, fewer than 10,000 DOM nodes, and no O(number-of-products) cart subscribers.

**Implementation status (2026-08-17): completed locally; not committed or deployed.**

- `src/lib/familyWindow.ts` bounds the initial document to 100 rows, grows in normalized 100-row steps, caps ordinary expansion at 500, rejects invalid/repeated/non-finite window parameters, and reserves unbounded rendering for explicit `?view=all`.
- `src/db/queries.ts` applies the limit after whole-result server filtering. Aggregate count/stock/lead-time/standards remain whole-result facts, and a `?pn=` deep link pins even the last SKU into the bounded first window rather than rendering all 2,400 rows.
- `src/components/FamilyCartController.tsx` owns the table through click/keyboard delegation and one `useCartSnapshot` subscription. The 100 rows are server markup rather than 100 `AddToCartRow` state islands plus 100 `InCartQty` subscriptions.
- Filter changes reset the result window; “load more” retains filters and the part-number target. EN/FA controls provide progressive load, explicit Find/Print view-all, and return-to-first-100 paths.
- Regression coverage in `src/lib/familyWindow.test.ts` covers the safe default, normalization/cap, explicit view-all, progressive growth, link preservation, and filter reset.

Final local acceptance evidence against the 2,400-row family:

| Gate | Before | After | Result |
| --- | ---: | ---: | --- |
| Compressed initial response | 1,460.2 KB | **93.6 KB** | Pass — below 300 KB |
| Decoded initial HTML | 8.93 MB | **527.2 KB** | Improved |
| Initial DOM elements | ~79,585 | **3,790** | Pass — below 10,000 |
| Initial product rows | 2,400 | **100** | Bounded |
| Family table cart subscribers/controllers | ~2,400 row subscribers | **1 table controller/subscriber** | Pass — O(1) |
| Five-sample warm median TTFB | 422.1 ms | **57.3 ms** | Pass |
| Five-sample warm median total | 658.9 ms | **69.0 ms** | Pass — below 250 ms |

Verification: `npm test` passes 134/134; `npx tsc --noEmit`, `git diff --check`, and the production build pass. Browser QA passed on English desktop and Persian 390×844 mobile with no horizontal overflow, framework overlay, or console warnings/errors. Progressive navigation rendered exactly 200 rows after one load-more action, retained an active material filter, and a SKU originally at row 2,400 rendered first and highlighted through `?pn=`. No production system or database was changed.

### P1-02 — Public CPU/database/write endpoints have no abuse controls and share a 32 MB body ceiling

**Evidence:** `next.config.ts:65-75`; `src/app/actions.ts:61-97` and `:109-187`; `src/app/[locale]/account/actions.ts:35-101`; `src/app/api/cart/route.ts:23-67`; `src/app/api/suggest/route.ts:4-12`; `src/lib/filters.ts:16-25`; `src/lib/admin.ts:6-12`.

There is no rate limiting on admin login, customer sign-in/sign-up, cart mutation, autocomplete, guest tracking, quick order, or quote submission. Sign-in and sign-up deliberately run memory-hard scrypt. Quote/account endpoints write durable rows. A global 32 MB Server Action limit exists solely for the importer but also permits very large public forms. Quick order has no line limit and executes one `addLine` sequence per parsed row. Family query parameters can create an arbitrary number of `EXISTS` predicates. The cart route parses an unbounded JSON body before validating its two fields.

**Recommendation:** Add layered per-IP and per-account limits at the edge/application boundary, with stricter limits for authentication and durable writes. Add explicit byte, field-length, filter-count, cart-line, and quick-order-line ceilings in every action/route. Move the large CSV importer to a dedicated upload/route path so public Server Actions can return to a small body limit. Add spam controls for account and RFQ creation.

**Implementation status (2026-08-17): completed locally; not committed or deployed.**

- `src/lib/requestLimits.ts` centralizes body, field, query, filter, quick-order, and cart ceilings. Route JSON is streamed and rejected above 8 KB before unbounded buffering; quick order is 32 KB/200 submitted lines; a cart holds at most 250 distinct products.
- `src/lib/rateLimit.ts` applies named policies through an atomic Postgres upsert. Raw IP/account identifiers are HMACed, known accounts consume both IP and account scopes, expired rows are indexed and probabilistically swept, and the table denies Supabase API roles through RLS/no grants.
- All entry points named in the finding are covered. Search/suggestion text, pinned part numbers, quote/account fields, list pages, and family predicates are bounded. Rejected filter/query parameters are not reflected into every generated family link.
- Quick order aggregates duplicate part numbers and uses one locked JSON-recordset upsert instead of one database transaction per line. Cart quantities cap at 99,999 and capacity is checked under the cart lock.
- The importer now uses `/api/admin/import` only for small same-origin authenticated control messages. CSV bytes upload directly to a private path-specific signed Supabase Storage URL, and the server verifies the signed family/path/size/expiry claim before review or atomic apply. Terminal objects are removed best-effort and abandoned objects are swept.
- `next.config.ts` lowers the global Server Action body ceiling from 32 MB to 4.25 MB. Catalog images are capped at 4,000,000 bytes to leave multipart headroom below the hosting payload ceiling.
- Migration `20260817020000_add_request_rate_limits.sql` must be applied before deploying this application build. Import deployments additionally need the browser-safe Supabase publishable/anon key and a private import-bucket name documented in `.env.example` and `docs/DEPLOYMENT.md`.

### P1-03 — The admin stock-shortfall warning is mathematically incorrect

**Evidence:** `src/db/inventoryQueries.ts:34-42` reserves stock by subtracting the order quantity from `inventory_available`; `:81-95` later warns when the same order quantity is greater than the already-reduced available quantity.

Example: with 100 packs available, an order for 60 is fully coverable. Reservation leaves 40, then `60 > 40` reports a shortfall. The current predicate effectively warns whenever an order consumes more than half the pre-order stock, not only when stock is insufficient. This can cause staff to make incorrect purchasing/fulfilment decisions.

**Recommendation:** Define the intended allocation rule explicitly. For aggregate advisory stock, a warning based on negative post-hold availability is the simplest accurate signal. If the UI must attribute shortages to individual orders, calculate allocation in order sequence or store the shortage at reservation time. Add transaction-level tests for sufficient, exact, insufficient, multiple-order, cancel, and paid transitions.

**Implementation status (2026-08-17): completed locally; not committed or deployed.** `findShortfalls` adds current holds back to reconstruct stock available before the pending reservation sequence, then uses a window allocation ordered by `created_at, order_id`. The integration suite proves 60 of 100 is sufficient, exact stock is sufficient, the later line in an overcommitted sequence gets the warning, payment preserves the truthful shortage, and cancellation reallocates stock to the next order.

### P1-04 — Docker sends local environment variants into the build context and the full-stack image lacks a reliable `AUTH_SECRET`

**Evidence:** `.dockerignore:1-7` ignores only the exact `.env` name; the current worktree also contains ignored `.env.local` and `.env.production.local` files. `Dockerfile:8-20` runs `COPY . .` before the build. `docker-compose.yml:24-45` passes only `DATABASE_URL` at build time and does not provide `AUTH_SECRET` at runtime. `src/lib/session.ts:13-29` requires it in production.

Local environment variants are therefore sent to Docker and copied into the builder layer/cache. They may not reach the final runner stage, but exposing secrets to a local or remote build context/cache is still unsafe. It also masks a functional defect: the Docker build can succeed only when an accidentally copied environment file supplies `AUTH_SECRET`. An explicit build with `AUTH_SECRET` empty compiled, then failed while collecting `/[locale]/account` page data exactly as expected. A clean clone/full-stack build has no configured build secret, and the runtime compose service also omits it.

**Recommendation:** Ignore `.env*` and explicitly re-include only `.env.example`. Provide `AUTH_SECRET` to both build and runtime through an appropriate BuildKit/runtime secret mechanism, not a copied file or persistent Docker `ARG`. Add a clean-context ARM64 Docker build/start smoke test that opens an account route.

**Implementation status (2026-08-17): completed locally; not committed or deployed.** `.dockerignore` now excludes `.env*` and re-includes only `.env.example`. The Dockerfile consumes required `database_url` and `auth_secret` BuildKit secrets without `ARG`/persistent `ENV`; Compose mounts the runtime signing key as `/run/secrets/auth_secret`. The resulting standalone image is `linux/arm64`, built without an environment file in its final 356.83 KB context, and served the public/account routes successfully. A separate Compose smoke proved the non-root app could read the runtime secret file and serve `/en/account/signin`; both temporary containers were stopped and auto-removed afterward.

### P1-05 — The installed production dependency tree has five high-severity advisories

**Evidence:** `npm audit --omit=dev --json` on 2026-08-16; installed versions confirmed with `npm ls`.

| Package path | Installed | Audit result | Exposure note |
| --- | ---: | --- | --- |
| `drizzle-orm` | 0.44.7 | High — identifier escaping / SQL injection, fixed in 0.45.2 | The app mainly uses parameterized postgres-js SQL and no attacker-controlled SQL identifiers were found, which limits current reachability; upgrade still required. |
| `next` → `sharp` | Next 16.2.12 / Sharp 0.34.5 | High inherited libvips issues, fixed by a newer dependency line | Image optimization handles remote catalog imagery, although URL entry is admin-only. |
| `next` → `postcss` | PostCSS 8.4.31 | High/moderate path-disclosure/XSS advisories | Primarily build-time in this repository; still part of the production install. |
| `nanoid` | 3.3.16 | High infinite-loop advisory for custom zero-size generators | No direct affected API use was found. |

The full audit reports 12 findings (8 high, 4 moderate), including development-only `drizzle-kit`/esbuild and `@vercel/config`/`path-to-regexp` chains. README's statement that all advisories are development-only is no longer true.

**Recommendation:** Upgrade in controlled groups, beginning with Drizzle ORM and the Next/Sharp/PostCSS line; run the full test/build/runtime/database suite after each group. Do not apply `npm audit fix --force` blindly because the suggested Drizzle transition is semver-significant for a 0.x package.

**Implementation status (2026-08-17): production exposure completed locally; not committed or deployed.** Drizzle ORM is pinned to 0.45.2 and Next to 16.3.1, which refreshes the affected Sharp/PostCSS/Nanoid paths. `npm audit --omit=dev` now reports zero vulnerabilities. The full audit's seven remaining findings belong to development-only CLI/config packages and are documented rather than “fixed” through the audit tool's breaking downgrade suggestions. TypeScript, 147 unit tests, both database integration suites, the production build, and Docker runtime smoke all pass on the upgraded tree.

### P1-06 — The live-data deployment process has no migration ledger and documentation promotes a destructive remote command

**Evidence:** `package.json` uses `drizzle-kit push` and hand-written additive scripts; `drizzle.config.ts:3-16` has no migrations output workflow and `strict: false`; `docs/DEPLOYMENT.md:130-168` documents objects that `push` removes and states that `db:setup:remote` truncates the catalog, carts, and orders. Despite that, `.env.example:51-55` and `README.md:133-137` tell operators to run `db:setup:remote`.

This is no longer a disposable v1 database: it contains users, orders, invoices, inventory, and admin-managed catalog data. The current workflow relies on command ordering, reapplying objects that the schema tool deletes, and remembering dated scripts. The most prominently copied remote setup command runs the seeder with a remote override and starts with `TRUNCATE ... CASCADE`.

**Recommendation:** Adopt reviewed forward-only SQL migrations with an applied-migration ledger, pre-migration backup/restore verification, and separate empty-database bootstrap from live upgrades. Remove `db:setup:remote` from normal deployment instructions, rename it to make destruction unmistakable, and require an explicit empty-database acknowledgement.

**Implementation status (2026-08-17): completed locally; not committed or deployed.** Timestamped SQL in `supabase/migrations` is applied through the Supabase migration ledger. Remote writes require `MIGRATION_BACKUP_VERIFIED` to equal today's UTC date; dry-runs need no write acknowledgement. `db:bootstrap:empty:remote` requires `EMPTY_DATABASE_CONFIRMED=1` and still refuses unless `public` has zero tables. Remote push/seed/setup scripts and instructions were removed, while the verifier now requires both P1 migration versions and their indexes. The local ledger is current; the live read-only dry-run reports both new migrations pending and no migration was applied.

### P1-07 — Quote submission is not idempotent and can create duplicate orders

**Evidence:** `src/app/[locale]/quote/page.tsx:50-108` submits an ordinary form without a pending/one-shot guard; `src/app/actions.ts:109-187` generates a new random reference and inserts an order on every request, then clears the cart only after the order transaction commits.

A double-click, client retry, function retry, or successful transaction followed by a failed cart clear can submit the same cart again under a new reference. There is no request/idempotency key or database uniqueness rule tying a submission to the cart/revision.

**Recommendation:** Generate and persist a one-time submission token tied to the cart revision, enforce uniqueness in the database, and make the server return the already-created reference on replay. Disable repeat UI submission as a usability measure, but do not rely on the button as the correctness boundary.

**Implementation status (2026-08-17): completed locally; not committed or deployed.** The quote page signs a 24-hour submission key, cart UUID, and stable fingerprint over product/quantity/displayed price. Migration `20260817010000_add_order_submission_key.sql` adds the nullable UUID and unique index without rewriting historical orders. Submission locks the cart parent, rechecks replay after the lock, verifies the current fingerprint, then creates the order/items, reserves stock, and clears the cart in one transaction. Concurrent integration requests produce one `created`, one `replayed`, the same reference, one order/item set, one hold, and an empty cart.

### P2-01 — Important business invariants are enforced only in application code

**Evidence:** `src/db/schema.ts:200-250`, `:285-305`, `:311-365`, and `:372-391`; `src/db/importQueries.ts:410-439`; `src/db/queries.ts:595-612`.

- Product part numbers are unique only with raw case sensitivity. The importer performs an application-level uppercase check, but concurrent imports or direct writes can still create case variants. Quick order already queries `upper(part_number)` without an expression index.
- `orders.user_id` has an index but no foreign key to `users.id`.
- Cart and order quantities, prices, pack quantities, lead days, and relevant totals lack basic non-negative/positive database checks.
- The current local data has no case-variant SKUs or orphan user IDs, so these are prevention gaps rather than active corruption.

**Recommendation:** Add an extension-managed unique index on `upper(part_number)` (after duplicate verification), a considered user foreign key/delete policy, and check constraints for quantities/prices/ranges. Validate UUIDs at the application edge and compare UUID-to-UUID.

### P2-02 — The database verifier gives a false green while denormalized counts and inventory disagree

**Evidence:** `scripts/verify-remote.mts:216-229` checks schema/search objects and broad row presence but no data invariants. Run against the local database, it printed `✓ database looks correct` while independent reconciliation found:

| Invariant | Stored | Reconciled |
| --- | ---: | ---: |
| `flow-level-control` category count | 20,659 | 659 |
| `flow-level-control/valves` category count | 20,528 | 528 |
| SKU `1000A1` on hold / sold | 0 / 0 | 8 / 5 |
| SKU `1000A2` on hold / sold | 0 / 0 | 1 / 0 |

Public category counts are recomputed by `CATEGORY_COLS`, so customers currently see the correct counts. The admin category list reads raw stored counts in `src/db/familyQueries.ts:54-61`, so staff can see wrong values. The inventory importer explicitly records mismatches but commits uploaded values (`src/db/importQueries.ts:634-680`), allowing drift to persist. These numbers describe the local snapshot only; production was not inferred from them.

**Recommendation:** Extend verification with actual-vs-denormalized family/category counts, facet-vs-JSON consistency, inventory-vs-order-ledger reconciliation, orphan checks, and status/timestamp/invoice invariants. Provide an explicit audited reconciliation command rather than silently accepting drift.

### P2-03 — Facet aggregation ignores its denormalized family key and scans far more data than necessary

**Evidence:** `src/db/queries.ts:286-302`; `product_spec_values.family_id` and composite indexes exist at `src/db/schema.ts:258-278`.

For the 2,400-row family, the current local plan scanned the 166,590-row facet table and took about 29.3 ms. Adding `v.family_id = 21` reduced the working set to roughly 12,000 rows and execution to about 9.6 ms. This is not the largest family-page cost, but it scales with the whole catalog instead of the family.

**Recommendation:** Add the family predicate and confirm the plan uses the family/spec indexes. Keep the matched-product join for active filters.

### P2-04 — Several avoidable queries and serial waterfalls remain on dynamic routes

**Evidence:**

- Family page: `src/app/[locale]/f/[slug]/page.tsx:78-91` fetches all products and separately counts the same unpaginated result, then performs a second category/ancestor stage.
- Search page: `src/app/[locale]/search/page.tsx:22-24` waits for search before starting the independent FX read.
- Admin queue: `src/app/[locale]/admin/(panel)/orders/page.tsx:80-115` performs the rate, orders, items, accounts, comments, and shortfalls in mostly serial stages; several can run together after order IDs are known.
- Quick order: `src/app/actions.ts:86-94` calls `addLine` sequentially for every row; each call checks/creates the cart, upserts one line, and updates the cart timestamp.
- Quote submission: `src/app/actions.ts:161-175` inserts each order item one at a time.

**Recommendation:** Remove the redundant family count (`products.length` is the total), join/cache immutable family/category metadata, start independent reads together, batch cart upserts/order-item inserts with `unnest`, and update the cart once per quick-order request.

### P2-05 — Admin session cookies are replayable beyond their browser expiry and omit `Secure`

**Evidence:** `src/lib/admin.ts:42-68` creates one deterministic HMAC of a constant using the admin password. The cookie has an eight-hour browser `maxAge`, but the token contains no issued/expiry time and the server accepts it indefinitely until the shared password changes. The cookie also omits `secure: process.env.NODE_ENV === "production"`.

**Recommendation:** Sign a payload containing issued-at, expiry, and session version with a separate secret; validate expiry server-side; set `Secure`; and preferably replace the shared credential with named staff accounts, revocable sessions, MFA, and an audit trail.

### P2-06 — Password changes/resets do not revoke existing 30-day customer sessions

**Evidence:** `src/lib/sessionToken.ts:3-14`; `src/app/[locale]/account/actions.ts:139-163`; `src/app/[locale]/admin/actions.ts:335-364`.

A stolen cookie remains valid after the owner changes their password or staff resets it. Signing out only clears the current browser.

**Recommendation:** Add a session-version field checked by the token, or a sessions table with revocation. Increment/revoke on password change/reset and security-sensitive profile changes.

### P2-07 — Server-side validation is inconsistent and malformed cart values can become 500s or invalid rows

**Evidence:** `src/app/actions.ts:29-47` and `:61-75`; `src/app/api/cart/route.ts:18-45`; `src/lib/cart.ts:93-118`; `src/app/[locale]/account/actions.ts:35-67` and `:110-128`; `src/app/actions.ts:114-156`.

- Server Actions accept fractional/non-integer product IDs and quantities; `updateQtyAction` can pass `NaN` or fractions into an integer column.
- API additions clamp the increment to 99,999, but the conflict update adds to the existing quantity without clamping the final result.
- A well-formed but nonexistent product ID reaches the foreign key and returns 500 instead of a 4xx response.
- Sign-up/quote validate presence but not normalized email/phone format or maximum lengths; profile update can blank fields that sign-up requires.
- Quote notes/address/company and quick-order input have no domain-specific maximums.

**Recommendation:** Centralize schemas for every action/route, reject rather than coerce invalid integers, clamp the final database value atomically, return typed 4xx/action errors, and pair application checks with database constraints.

### P2-08 — Catalog media saves can partially commit and leak storage objects

**Evidence:** `src/app/[locale]/admin/(panel)/products/categories/[id]/actions.ts:135-178`; `src/lib/catalogStorage.ts:140-169`.

Uploads occur sequentially under a new random object name. If a later upload fails, earlier objects remain orphaned. Database entity updates then run one by one without a transaction; if a later ID is missing/fails, earlier rows remain changed even though the action returns an error. Replacing/removing an image never deletes the previous object. This contradicts the page-level “nothing is written unless everything is valid” expectation for the database phase.

**Recommendation:** Upload to staged object keys, apply all database changes in one transaction, then delete superseded/staged objects with compensating cleanup. Add an orphan-reconciliation job/report.

### P2-09 — Autocomplete and modal/sheet focus behavior do not meet accessible widget semantics

**Evidence:** `src/components/SearchBar.tsx:165-220`; `src/components/MobileFilterBar.tsx:53-60` and `:98-207`; `src/components/ConfirmSubmit.tsx:49-61` and `:100-149`; `src/components/MobileHeader.tsx:74-80` and `:163-234`.

- Autocomplete implements arrow keys visually but lacks combobox/listbox/option roles, `aria-expanded`, `aria-controls`, and `aria-activedescendant`.
- The mobile filter sheet declares a modal dialog but does not move focus into it, trap focus, handle Escape, or restore focus.
- Confirmation dialogs handle Escape but do not establish initial focus, trap it, or restore the opener.
- The mobile navigation overlay has the same focus-containment/restoration gap and no `aria-controls` relationship.

**Recommendation:** Implement established accessible combobox/dialog patterns, preferably with small tested primitives. Add keyboard and screen-reader-oriented component/E2E tests in both directions/locales.

### P2-10 — The quality gate is incomplete: lint is broken, CI is absent, and tests cover only pure helpers

**Evidence:** `package.json` defines `"lint": "next lint"`; there is no ESLint configuration/package and no `.github` CI workflow. All 13 test files are under `src/lib`; `npm test` glob is `src/lib/*.test.ts`.

The 128 tests are valuable but do not cover SQL queries, transactions, Server Actions, auth/ownership, import integration, route status behavior, browser flows, accessibility, or performance budgets. The broken lint command can appear to be a quality gate while never linting anything.

**Recommendation:** Install/configure a supported ESLint invocation, add CI for clean install, lint, typecheck, unit/integration tests, production build, and dependency audit policy. Add disposable-Postgres integration tests and a focused Playwright suite for EN/FA desktop/mobile critical flows.

### P2-11 — Category-list pagination accepts non-finite/fractional/out-of-range pages

**Evidence:** `src/app/[locale]/l/[...slug]/page.tsx:51-67` uses `Math.max(1, Number(sp.page) || 1)` directly as the page and offset.

`?page=Infinity` produced HTTP 500 with PostgreSQL `invalid input syntax for type bigint: "Infinity"`. `?page=1.5` produced an offset of 50, overlapping pages while no pagination item represents the current page. Pages beyond the last render an empty result instead of a canonical redirect/404.

**Recommendation:** Parse a finite positive integer, floor/reject fractions, calculate page count before querying or use a bounded count/query flow, and redirect to a canonical in-range URL.

### P2-12 — Guest tracking places customer email addresses in URLs and logs

**Evidence:** `src/app/[locale]/track/page.tsx:9-16` explicitly acknowledges that the GET form places email in browser history and access logs; `:55-81` submits it as a query parameter.

The result is `noindex`, but email still reaches browser history, copied URLs, proxy/platform access logs, analytics/referrer surfaces, and screenshots. Reference plus email is also guessable and currently has no rate limit.

**Recommendation:** Use a POST lookup that does not put PII in the URL, or issue an opaque, short-lived signed tracking token after validation. Apply strict lookup rate limiting and ensure responses/logs are `no-store`/redacted.

### P2-13 — Production has page-view analytics but no evidence for diagnosing slowness or failures

**Evidence:** `src/app/[locale]/layout.tsx:60-65` includes Vercel Analytics only. No Web Vitals/Speed Insights integration, error reporting, route/query timing, or alerting configuration exists in the repository.

The repository contains detailed incident comments but no durable telemetry to distinguish server queueing, database time, RSC generation, transfer, and hydration in real traffic.

**Recommendation:** Add privacy-conscious Web Vitals, server error reporting, per-route timing, slow-query sampling, and alerts. Record family row count/payload class with timings so regressions correlate to catalog size.

### P3-01 — Search/autocomplete does unnecessary work and does not honor its result limit globally

**Evidence:** `src/db/queries.ts:321-390` applies `limit` independently to categories and families plus five products, then concatenates them; `:500-512` fetches 60 products while `src/app/[locale]/search/page.tsx:71` renders 30. `src/components/SearchBar.tsx:87-113` aborts the prior request only after the next debounce fires.

`suggest(q, 6)` can return up to 17 entries; `oring` returned 10. Search transfers/ranks 30 products it discards. A stale request can update results during the 130 ms gap before the next timer. The header also renders separate mobile and desktop `SearchBar` components and hides one with CSS; on a results page both initialize from `q` and can fetch duplicate suggestions.

**Recommendation:** Merge/rank candidates under one global limit, align SQL/render limits, abort immediately in effect cleanup, cap query length, and avoid hydrating/fetching from a hidden duplicate search instance.

### P3-02 — UUID columns are cast to text in ownership/account queries, bypassing their indexes

**Evidence:** `src/db/userQueries.ts:17-22`, `:95-105`, and `:116-124`; `src/db/accountQueries.ts:20-31` and `:63-79`.

Casting indexed `uuid` columns to text prevents normal use of the UUID indexes. Current user/order counts are tiny, so this is not a present bottleneck.

**Recommendation:** Validate/parse the signed token's user ID as UUID at the application edge, then compare UUID values directly.

### P3-03 — Shared and latent product imagery can add avoidable transfer cost

**Evidence:** `public/temex-logo-cropped.jpg` is 94,719 bytes but renders at 77×22 or 123×35; the local response is `Cache-Control: public, max-age=0`. `src/components/ProductDetails.tsx:54-62` uses a raw image without `loading="lazy"`, even though every collapsed detail row is present in the document. `next.config.ts:51-64` now permits HTTPS optimization, making the comment that arbitrary hosts cannot use `next/image` stale.

Current local data has zero product image URLs, so the product-image issue is latent. If images are populated, an unbounded family could emit thousands of eager raw images.

**Recommendation:** Replace/hash and long-cache the small logo asset (or use the SVG), use optimized/lazy product imagery, and pair this with bounded/progressive family rendering.

### P3-04 — Cart synchronization duplicates work and anonymous carts have no lifecycle cleanup

**Evidence:** `src/components/CartSync.tsx:15-22` and `src/components/CartPageSync.tsx:19-24` both call `refreshCart` on initial cart-page mount. `src/app/api/cart/route.ts:13-15` reads count and quantities separately. `src/lib/cart.ts:108-131` does not update cart timestamps for set/remove/clear, and there is no expiry cleanup job.

The cart page can make two identical refresh requests on arrival. A year-long anonymous cart cookie plus no database cleanup allows abandoned carts to accumulate. Current local data has only nine carts, so this is a scaling/housekeeping issue.

**Recommendation:** Deduplicate in-flight refreshes, derive count from the quantities query, consistently touch `updated_at`, and add a retention cleanup policy/job.

### P3-05 — Response hardening is minimal

**Evidence:** `vercel.ts:31-46` configures only font caching. A local production response exposed `X-Powered-By: Next.js` and had no CSP, `Referrer-Policy`, `Permissions-Policy`, or frame policy. Vercel may add transport security at the edge, so HSTS was not inferred from localhost.

**Recommendation:** Disable `poweredByHeader`; add a tested CSP and standard security/privacy headers in Vercel/Next configuration, taking invoice printing, analytics, images, and Supabase origins into account.

### P3-06 — Documentation and source comments have materially drifted from the application

**Evidence:**

- `README.md:190-211` says buyer accounts are not built.
- `README.md:235-237` says there are four client islands; there are 26 `"use client"` files.
- `README.md:239-250` claims a 4.7 ms indexed facet pass; current measured query is about 29 ms and scans the full facet table.
- `README.md:518-519` says all advisories are dev-only; the production audit now reports five high findings.
- `docs/ARCHITECTURE.md:22-25` describes family/search catalog routes as statically rendered with revalidation, while the family response is private/no-store and request-driven.
- `src/app/[locale]/f/[slug]/page.tsx:43-57` still describes the pre-fix double-layout rendering and old size.

**Recommendation:** Refresh the README/architecture after remediation and add a short generated verification snapshot (test count, supported routes, audit date, performance date) rather than embedding facts that silently age.

### P3-07 — A few smaller maintainability/correctness issues should be cleaned up with adjacent work

- `addToCartAction` in `src/app/actions.ts:29-34` has no callers.
- Category/family creation slug selection in `src/db/familyQueries.ts:322-340` is check-then-insert and can race under concurrent admin requests.
- File upload validation trusts the browser-provided MIME type and does not inspect magic bytes (`src/lib/catalogImages.ts:31-50`).
- Remote image optimization permits every HTTPS host (`next.config.ts:51-64`), an admin-only but real server-side fetch/billing surface.
- Only one of the 68 untranslated Persian-route values appears clearly descriptive (`Forged AISI 4130 (API 60K)`); the rest should be explicitly classified as technical values so the diagnostic distinguishes intentional Latin from missing translation.

## What is working well

- Parameterized postgres-js templates are used consistently for values; no direct SQL injection in business queries was found.
- Customer invoice ownership is checked before disclosure, and guest invoices remain staff-only.
- Order status changes use legal-transition checks plus atomic status predicates; inventory moves that accompany transitions are transaction-bound.
- Quote header/items/initial stock hold are transactional.
- Password hashing uses salted built-in scrypt and equalizes unknown-user sign-in work.
- Public catalog visibility is consistently inherited through hidden taxonomy branches.
- RLS is enabled on all local public tables, with extension/search objects present.
- Category ISR and the prior responsive-table consolidation materially improved the common routes.
- English/Persian directionality and mobile width handling were sound in the sampled routes.

## Remediation sequence and current status

### Phase 1 — Protect the current system and fix the user-visible bottleneck

All seven P1 items below are implemented and verified locally. They remain uncommitted and undeployed.

1. Add failing regression/performance tests for inventory shortfall, list pagination, quote replay, family payload/DOM budget, and public input limits.
2. Bound/progressively render family results and consolidate row-level cart state into one controller.
3. Add rate limits, request/field/line ceilings, and small public Server Action bodies.
4. Make quote submission idempotent.
5. Fix stock-shortfall calculation.
6. Repair Docker secret handling/build/runtime and update the dangerous deployment instructions.
7. Upgrade production dependencies in isolated, verified groups.

### Phase 2 — Make data changes safe and self-verifying

1. **Completed locally:** introduce migration files/ledger and a verified backup/restore gate.
2. Add database uniqueness/FK/check constraints after a read-only production preflight.
3. Extend verification and reconcile denormalized counts/inventory with an auditable command.
4. Add the facet family predicate and batch the remaining N+1 writes/waterfalls.

### Phase 3 — Close quality, accessibility, and operational gaps

1. **Partially completed locally:** lint is restored and focused database integration tests exist; CI, browser E2E, and automated accessibility checks remain.
2. Replace admin/customer session limitations according to the desired production auth model.
3. Make media updates transactional with object cleanup.
4. Add production Web Vitals/error/query telemetry and enforce performance budgets.
5. Refresh documentation, assets, security headers, and low-priority cleanup items.

## Suggested acceptance gates

- Largest-family initial response: under 300 KB compressed, under 10,000 DOM nodes, local warm total under 250 ms, and O(1) cart-store subscribers.
- No public request can submit more than the documented small body/field/line/filter limits.
- Duplicate quote submission returns the original reference and creates exactly one order/hold.
- Inventory tests cover sufficient/exact/insufficient/multiple/cancel/paid paths.
- Database verifier fails on deliberately corrupted counts, facets, inventory, orphan ownership, and invoice invariants.
- Clean ARM64 Docker context builds and serves `/en`, `/fa`, `/account`, and `/admin` without any `.env*` file in the build context.
- Lint, typecheck, unit tests, DB integration tests, production build, and an audit policy run in CI.
- Keyboard-only flows pass for search, mobile filters/navigation, confirmation dialogs, cart, quote, and admin actions in EN and FA.

## Limitations

- The hosted production database was inspected only through a read-only migration dry-run. Supabase Storage contents/policies, Vercel deployment logs, and production traffic were not mutated or deeply inspected. The new signed Storage importer was reviewed statically and through unit/build/auth-boundary checks because the local Docker service is PostgreSQL only, not a complete Supabase stack.
- Dependency advisories are current as of the audit date and can change; reachability notes above are code-review judgments, not proof that every upstream vulnerable path is exploitable here.
- Performance numbers are local warm production-server measurements intended to compare application paths. They deliberately exclude the database/server geographic latency requested out of scope.
- Manual browser/static accessibility review is not a substitute for assistive-technology user testing.
