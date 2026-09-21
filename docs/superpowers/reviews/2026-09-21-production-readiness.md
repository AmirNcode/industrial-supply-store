# Production readiness review — 2026-09-21

**Status: implementation and local verification complete; production release is pending recovery approval and migration.** The owner authorized the remaining fixes and the Persian default. The optional admin selector was explicitly cancelled. No production data writes, main-branch pushes, or deployments have been performed.

## Remediation completed

- The bare root redirects to `/fa`; English remains available through the existing switch, preserving the current path and query. Invalid/missing posted locales also use Persian. No language setting or new preference cookie was added.
- New-product creation uses an insert-only transaction contract and localized duplicate/reserved/capacity errors. Repeated submissions cannot overwrite an existing product. Numeric form values are bounded to the database's integer range.
- Imports reserve supplied TEMEX-shaped codes before allocating blanks, bind reservations to the exact live product, and reject reuse after deletion. Lowercase supplier spellings and codes in another family's range are also protected. Ordinary CSV updates to the same live product continue to work.
- A transaction-scoped advisory lock serializes allocation and import conflict checks across families. Allocation uses unoccupied prefixes and skips occupied variant slots without the old arbitrary retry limit. Failed writes do not consume numbers or mutate caller input.
- CSV review retains valid rows when other rows are invalid, accurately shows blank-number consent, and preserves the submitted mapping and upload when another review is needed.
- The seeded collision fixture is corrected. Database regression tests cover the defects, rollback, capacity, migration compatibility, and concurrent writes.
- The release verifier now requires the registry, family columns, checks, indexes, deletion behavior, migration entry, and consistent reservation ownership/counters.
- Next.js and eslint-config-next are pinned to `16.3.5`; Sharp resolves to `0.35.4`. The production dependency audit reports zero vulnerabilities.
- The pending migration includes a one-time ownership repair for reservations created by earlier local feature testing. The existing local database had 31 such records; applying the migration linked them to their existing products. Product count remained 34,016 and its final verifier passed. No product numbers were changed.
- The implementation plan and deployment instructions now reflect no renumbering and migration-before-deployment ordering.

## Final local verification

All destructive test setup and regression writes used the disposable local database `isupply_review_20260921` in `/tmp/isupply-readiness-20260921`, with test-only environment values. The ordinary local database received only the reviewed additive migration and reservation repair described above.

| Check | Final result |
| --- | --- |
| ESLint / TypeScript / diff whitespace | Pass |
| Unit tests | 189 passed |
| Existing order, integrity, taxonomy, and rate-limit DB suites | All passed |
| Part-number DB regression suite | 20 passed, including the migration compatibility test |
| Fresh bootstrap with final migration | Pass |
| Updated local schema/data verifier | Pass on disposable and existing local databases |
| Normal production build | Pass: Next.js 16.3.5, Turbopack, 36 static pages |
| Browser/accessibility suite | 32 distinct scenarios passed; 6 intentional viewport-specific skips |
| Production dependency audit | Zero vulnerabilities |
| Updated production verifier | Correctly refuses readiness because the part-number migration is absent |

Browser coverage includes successful creation, duplicate/deleted-code rejection, preserved input after errors, CSV consent submission, root redirect, explicit language navigation, query preservation, and existing catalog/cart/admin/accessibility behavior in EN/FA on desktop/mobile. The new mobile locale test was corrected to open the existing menu before selecting English, then passed on both viewports. Temporary pre-fix defect-reproduction probes were removed from the test copy; they intentionally expected the old broken behavior. No failing release test remains.

CSV browser tests mock the signed-storage transport; the database suite exercises the real review and allocation logic. An authenticated upload through hosted Supabase Storage remains a release smoke check, not a result claimed by the local tests.

Evidence logs are under `/tmp/isupply-readiness-*.log`, including `build`, `db-final`, `part-final`, `verify-after-browser`, `e2e-final`, `locale-browser`, and `existing-local-verify-final`.

## Remaining production steps

1. Obtain approval for a production application-data backup to the ignored local `other_ignore/release-backups/` folder, and verify a local restore; alternatively obtain equivalent verified recovery evidence. Automatic approval review rejected the proposed export because users/orders would be copied to a local archive without specific export authorization. The export did not run, and no backup is claimed.
2. Apply `20260920120000_add_temex_part_numbers.sql` to production after verified recovery evidence and production authorization. Then run the updated remote verifier and read-only reconciliation. Do not set `MIGRATION_BACKUP_VERIFIED` without that evidence.
3. Push the tested release to main, verify Vercel's deployed commit, and smoke-test `/` → `/fa`, English navigation, and the authenticated signed-Storage import flow.

The pending migration's SHA-256 is `c8fd93cf16b98d1fe0b1299f6e1531df30a0f9e70990148a052fef94567159fb`. The patched lockfile's SHA-256 is `af478d6a8a32f1ff734f1eca54a9627be16c9ebbb24971e58c550efe180fecd3`.

The remaining sections preserve the initial read-only findings and baseline evidence. They describe defects before the fixes listed above, not unresolved code defects.

## Reviewed state

- Local branch: `feat/temex-part-numbers`, HEAD `37c57b3f1618876523cd1f032a8b0138facf2bfd`.
- GitHub `main`, verified with `git ls-remote`: `b66a1cfa1df1b634b06769032895f75827013138`.
- Latest READY production deployment in Vercel: `dpl_27PprM9sZCVvCbADLdNkXTfARSUX`, the same `b66a1cf` commit. [Deployment](https://vercel.com/amir-n-projects/industrial-supply/27PprM9sZCVvCbADLdNkXTfARSUX).
- Six local commits, 23 changed files, 1,297 insertions / 25 deletions relative to main. No other local branch contains additional unpublished work: the family-page redesign is already in main.
- The implementation plan and `docs/TEMEX_Part_Number_Implementation_Handoff/` were untracked when review began; a normal push will not include them unless committed.
- Production database: `industrial-supply-store`, project `myyjeiujwtkwlemidvow`. Read-only checks found 34,177 products, 117 families, 6 orders, and 10 customer accounts. The owner subsequently confirmed on 2026-09-21 that everything in production is test data.

## Orientation

This is a bilingual English/Persian Next.js application. Raw PostgreSQL queries implement catalog, CSV import, carts, customer accounts, orders, invoices, and advisory inventory; Drizzle defines the schema. Staff use a shared-password admin session, separate from customer sessions. CSV uploads go directly to private Supabase Storage before server validation and one atomic catalog-write transaction. Vercel deploys the app from Git; the repository's migration workflow updates the hosted database separately.

The unpublished work adds the TEMEX encoder, family counters and permanent number reservations, optional automatic numbering for CSV rows, and a single-product creation screen. It deliberately preserves matching by supplied part number. The implementation plan overrides the older handoff's fingerprint-based deduplication design, so identical specifications in blank-number rows becoming separate products is not reported as a defect.

## Blocking release prerequisites

### Production migration is pending, and the verifier misses it

`npm run db:migrate:check:remote` reports exactly one pending migration:

`20260920120000_add_temex_part_numbers.sql`

Independent schema queries confirmed `part_number_registry` and both `product_families.family_number` / `next_variant_ordinal` are absent. `writeImport` now calls the registry path for every nonempty import, including imports containing only existing supplied numbers. Deploying the app first breaks catalog import and product creation; this is not limited to blank-number uploads.

At the same time, `npm run db:verify:remote` exits successfully because its required tables, columns, constraints, indexes, and migration list were not extended for this feature (`scripts/verify-remote.mts:33`, `:200`). Add the new objects and reservation consistency checks to verification. Keep the successful existing integrity result, but do not treat it as verification of this release's schema.

The migration is additive and does not renumber existing products. Apply it before the new application, only after a verified recovery point and restore procedure. No backup/restore evidence was available in this review; none was assumed.

### Production dependency audit fails — pre-existing

`npm run audit:prod` exits 1: one critical Next.js advisory group and one high Sharp advisory. The lockfile is identical on main and this branch, so these are existing dependency problems, not introduced by the part-number feature.

- Next.js `16.3.1`: [AVIF image-optimization remote-code-execution advisory](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4). The advisory lists `16.3.3` as patched; the current npm audit proposes `16.3.5`. The separate Windows-hosting advisory also appears in audit; its applicability to this Linux/Vercel deployment is not claimed.
- Sharp `0.35.3`: [libheif advisory](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c), patched at `0.35.4`.

Upgrade to verified patched dependencies, update the lockfile, and rerun audit/build/tests. This review did not attempt exploitation or establish the hosting platform's mitigations. The failing audit is itself a CI release gate.

## Confirmed defects in the unpublished code

### P1 — Add a product can silently overwrite an existing product

Location: `src/app/[locale]/admin/(panel)/products/[id]/new/actions.ts:93-104` and `src/db/importQueries.ts:518`.

The create form accepts a typed part number, passes it to the import upsert, and treats `updated === 1` as successful creation. Reusing a number already in this family overwrites price, specs, pack quantity, lead time, and uploaded stock values rather than refusing creation. Empty spec inputs can erase existing specifications.

A database probe observed `inserted: 0, updated: 1` and a changed price for the original product ID. Two additional browser probes reproduced the actual form behavior in English and Persian: create a generated-code product at $12.34, submit Add a product again using that code at $99.99, and observe the same product ID now priced at $99.99 while the UI reports creation success. The creation operation needs an insert-only contract enforced in the transaction, with a clear duplicate-number response. Checking only before the transaction would leave a race.

### P1 — Deleted codes can be reused through supplied-number imports

Location: `src/db/partNumberQueries.ts:171-189`, `src/db/importQueries.ts:433-474`.

The conflict check reads only live products. A reservation conflict is ignored with `ON CONFLICT DO NOTHING`; it does not prove that a supplied number belongs to the same still-existing product. Registry `product_id` is never populated by the write path.

Probe: mint `1002A001`, delete its product, then import a different product using that code. The import succeeds with `inserted: 1`; the old product ID was 34224 and the replacement was 34225, while the registry still held `product_id: null`. This breaks the documented never-reuse guarantee.

Bind reservations to their products and reject supplied reserved codes after deletion or when associated with a different product. Preserve normal updates of the same live product.

### P2 — Mixed supplied/generated numbers can collide within one CSV

Location: `src/db/importQueries.ts:461-474`.

Blank rows are allocated before supplied rows are reserved. The allocator checks existing database products, not explicit codes elsewhere in the same incoming batch.

Probe: a family with its next slot at `A001`, one incoming explicit `<family>A001` row, and one blank row. Both become the same code; PostgreSQL aborts with SQLSTATE `21000`, `ON CONFLICT DO UPDATE command cannot affect row a second time`.

Validate/reserve all incoming explicit codes before allocating blanks, and check the complete final batch for duplicate/case-equivalent codes. Tests need explicit TEMEX codes, not just the current mixed-import test's `LEGACY-*` example.

### P2 — First assignments in different families race

Location: `src/db/partNumberQueries.ts:38-59`, `:86-87`.

`FOR UPDATE` locks one family, but the prefix is selected with global `MAX(...) + 1`. Two transactions locking different new families can choose the same prefix. The unique index prevents duplicate committed prefixes, but one legitimate operation fails.

A controlled concurrent probe returned prefix 1003 for one transaction and SQLSTATE `23505` on `families_family_number_key` for the other. The existing concurrency test exercises two allocations in the same already-numbered family, so it does not cover this race.

Serialize the shared prefix allocation or use a database allocator with safe collision handling; cover first assignment across different families.

### P2 — Skip-invalid-rows cannot finish when valid rows need codes

Location: `src/lib/catalogImport.ts:178-188`, `ColumnReview.tsx:214`.

The review dry run uses `skipBadRows: false`, which returns no rows if any error exists. Therefore `blankRows` becomes zero and the generate-numbers choice is hidden. Ticking skip-invalid-rows does not recompute it.

Read-only probe input:

```csv
part_number,price_usd
,10
,not-a-price
```

Review returned `goodRows: 1, blankRows: 0`. Applying with `skipBadRows: true` then returned `needs-numbers: 1`, but there had been no numbering checkbox to enable. Review should count valid blank rows independently of whether invalid rows currently block submission, and remain consistent with the chosen column mapping.

### P2 — Fresh-database CI fails in the new integration test

Location: `src/db/partNumbers.integration.test.ts:245-258`.

After the same seed/bootstrap path used by CI, the prefix-collision test tries to insert `1000A500`, which is already seeded. The fixture fails before exercising the allocator with SQLSTATE `23505` on `products_part_number_key`.

Use an isolated fixture/prefix that is not already present, and ensure cleanup encompasses fixture setup. A passing run against an existing developer database does not establish that clean CI passes.

## Scope confirmed by the owner — 2026-09-21

Existing products will not be renumbered. The owner confirmed that the listed products are mostly samples and will be replaced as real products are added; all production records are still test records. Automatic numbering for newly added products remains in scope.

This decision supersedes the existing-catalog conversion requirement and Task 5 in `docs/superpowers/plans/2026-09-20-temex-part-numbers.md`. The absent renumbering script is not a release blocker. The additive schema migration and the confirmed correctness/security fixes remain required. Confirmation that data is for testing does not instruct this review to delete or replace it.

## Additional release requirement — default language

Final owner decision: visiting `temex.ir` should open `/fa`, and English remains available through the existing language switch. The owner explicitly dropped the admin settings toggle and authorized implementation. The fixed root redirect and safe fallback now use Persian. Existing `/fa/...` and `/en/...` links keep their specified language; revisiting the bare root always uses the site default.

## Initial review verification and limits

All write-based checks used `/tmp/isupply-readiness-20260921` and the disposable local database `isupply_review_20260921`. The original application's environment files and normal local database were not used for these writes. The review copy has generated test-only auth values and no Supabase Storage credentials.

| Check | Result |
| --- | --- |
| ESLint | Pass |
| TypeScript | Pass |
| Unit tests | 189 passed |
| Branch diff whitespace | Pass |
| Existing order/integrity/taxonomy/rate-limit DB suites | Pass |
| New part-number DB suite | 8 passed, 1 failed as described above |
| Isolated production build | Pass using Webpack; 36 static pages generated |
| Repository browser/accessibility suite | 22 passed, 6 intentional skips; EN/FA desktop/mobile |
| Additional product-creation browser probes | Both EN and FA reproduced an existing-product overwrite after successful generated-code creation |
| npm production dependency audit | Fail: 1 critical, 1 high |
| Production migration dry run | One pending migration |
| Existing production schema/data verifier | Pass, with new-schema blind spot described above |
| Production reconciliation read-only check | Pass; all reported canonical/derived mismatch counts zero |
| Additional focused DB probes | Reproduced the five behavioral defects above |

The repository browser suite's new product test covers opening the form and rejecting an invalid price, not successful creation/duplicate protection; the additional review-only probes exercised those missing paths locally. Real authenticated production admin writes and the full signed-Storage CSV upload path were not exercised. Vercel's exact production environment values, current backup/PITR recoverability, branch protection, and deployment gating on GitHub checks were not verified. The Vercel project-details connector returned an input-validation error; deployment listing succeeded. Do not assume a push to main waits for the failing GitHub checks before deploying.

Supabase security advisors also reported existing mutable function search paths and extensions installed in `public`; these were not changed here. Follow-up references: [function search paths](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable), [extensions in public](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public). RLS-enabled/no-policy notices match this application's documented owner-connection access model and are not counted as defects.

## Release safety

Follow the remaining production steps at the top of this report. The migration is additive and preserves all product numbers. Do not use bootstrap/reset scripts, catalog renumbering, or bare schema push against production.
