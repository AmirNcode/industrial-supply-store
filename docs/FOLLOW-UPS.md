# Follow-ups

Open work found in passing, with enough context to pick up cold. Delete an
entry when it is done; move nothing here that belongs in a commit message.

## Free-tier usage (from the 2026-10-13/14 Supabase egress incident)

Background: Supabase Free egress hit 6.08 / 5 GB in the cycle 15 Sep – 15 Oct
2026 (cached egress only 0.07 GB, so it is database traffic). Daily egress was
~20 MB until 29 Sep, then 300–900 MB/day, matching crawler waves (Meta, OpenAI
GPTBot, then Baidu). Supabase restricts the org from **12 Nov 2026** if it is
still over quota, so the cycle starting 15 Oct must average under ~150 MB/day.

Root cause: `/[locale]/f/[slug]` reads `searchParams`, so every family page —
and every filter combination — is rendered from the database per request
(`no-store`, ~1.4 MB HTML, ~200 crawlable filter links). `pg_stat_statements`
showed ~99% of family builds were filtered views.

Done on 2026-10-14: robots.txt disallows `/en/f/*?`, `/fa/f/*?` and
Baiduspider; firewall rule "Block Alibaba Cloud and Baidu" (AS45102 OR UA
`Baiduspider` OR 116.179.32.0/20 → deny); Bot Protection switched Log →
Challenge. Baidu was confirmed denied from the 01:00 UTC hour onward.

Monitoring: `node local-tools/usage-check/check.mjs` (local only, runs every
6 hours via launchd; history in `local-tools/usage-check/logs/`).

1. **Confirm the drop.** On or after 16 Oct, check the Supabase usage page
   ("Egress per day": each day < ~150 MB) and the usage-check logs. Expected
   but unmeasured: unblocked Vercel traffic ~18k/day (budget 33k/day), and
   Google's crawling of filtered family URLs stopping once it re-reads
   robots.txt.
2. **If family pages are still built thousands of times a day,** cache them.
   Not done yet on purpose: on Vercel a data cache or ISR lands in ISR/runtime
   cache units, which Hobby cannot show, so the overage could move somewhere
   unmeasurable. If needed, the likely shape is the category page's: a
   cacheable bare family route (no `searchParams`) with filtered views on a
   separate dynamic route, plus `revalidatePath` on every write that changes
   family-page content — `writeImport` (product table + CSV import),
   `saveColumnsInTransaction`, `familyQueries` writes, inventory holds
   (`inventoryQueries`), and price settings / the fx-rate cron, because family
   pages show prices.
3. **Bot Protection = Challenge: verify the collateral.** Untested: the
   17:30 UTC `/api/cron/fx-rate` job (check the rate updated on 14 Oct),
   Telegram and WhatsApp link previews, and the Enamad seal check. If any is
   blocked, add a bypass custom rule for it, or revert with
   `npx vercel@latest firewall rules edit bot-protection --action log --yes`
   then `npx vercel@latest firewall publish --yes`.
4. **First live run of the usage check's database section.** It was only
   tested against a throwaway Postgres (the agent's auto-mode classifier
   refuses production reads). Check `local-tools/usage-check/logs/scheduled.log`
   after the first scheduled run, and recalibrate `KB_PER_FAMILY_BUILD` (27 KB,
   rough) against the Supabase egress chart once day-by-day rates exist.
5. **Supabase log ingestion** was 0.47 / 1 GB in the cycle, rising ~40 MB/day;
   Supabase enforces the 1 GB limit from 2027. ~3,300 new pooler connections a
   day (`pgbouncer.get_auth`) add to it — the pool settings and their
   connection-churn history are in the comment above them in `src/db/index.ts`.
6. **Vercel Web Analytics beacons** (`/e0bffe1b9d582ae9/view`) were ~6k
   requests/day, largely crawlers that run JavaScript. They count as edge
   requests; worth a look if the 1M/month cap gets close.

## CI

7. GitHub's `ubuntu-latest` moves to Ubuntu 26 from **19 Oct 2026**, and
   `actions/upload-artifact` (pinned SHA) targets the deprecated Node 20
   runtime. Both are annotations today, not failures; update the workflow
   before they become one.
8. `npm audit` (dev dependencies included) reports 12 issues (8 high). CI only
   gates on production dependencies (`audit:prod`, clean as of 870912f); the
   dev ones are unreviewed.

## Tooling

9. The Supabase CLI on this machine is logged in to the Vercel-integration org
   only, not Noor Corp (the live project's org). The usage check doesn't need
   it; anything using the Management API for the live project would.
