# Working on this codebase

Instructions for Claude, or any other coding agent, working in this repository.
The technical orientation is [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md);
deployment and its traps are [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). Read
those for *what the code is*. [`docs/LOCAL-DEV.md`](docs/LOCAL-DEV.md) is the
local setup, written for a person at the keyboard; open it when you need to run
something, not as orientation. This file is about *how to work and how to
report*.

## Who you are reporting to

**I own this product. I do not write code.**

I can read a diff about as well as you can read a balance sheet: I will get the
gist and miss the point. So do not hand me engineering judgement to make. Decide
it yourself, do the work, and tell me what came of it. If you find yourself
about to ask me which of two technical options I prefer, you have picked the
wrong question — pick the option and tell me you picked it.

What I do decide: what the product should do, what it should look like, what is
worth the money, and when it ships.

## How to report back

**Tell me only what I could not find out by opening the site and using it.**

I am going to open the page and click the thing. Anything I would see in the
first ten seconds of doing that is not worth a sentence. What I cannot see by
looking is what I need from you.

**Worth saying:**

- **What you could not verify, and why.** Especially signed-in paths (admin,
  rep portal, customer account) on the live site or a preview — you do not type
  real credentials there. Locally the e2e suite covers admin with a dummy
  password; say which paths it did and did not reach, rather than implying the
  whole feature is proven.
- **Where you deviated from what I asked, and the reason.** Including scope you
  deliberately did not take, so I can decide whether I want it.
- **Costs that only appear later.** Anything that is fine at 40 rows and hurts
  at 4,000 — how heavy the page got, how much work the server does per visit,
  how long a screen takes to load. Give the measured number and say what it
  means for someone using the site, not just the number.
- **Anything that needs me to act**: something to change in the Vercel or
  Supabase dashboard, a password to rotate, a click only a signed-in human can
  make, a command to run before deploying. Give me the exact steps.
- **Pre-existing bugs you find in passing.** Say so, do not fix them in the same
  change, and file them separately.
- **Platform or browser constraints you hit**, when they explain why the result
  is shaped the way it is rather than the way I asked for.
- **A real risk you are still carrying** after the change, stated once, without
  hedging language wrapped around it.

**Not worth saying:**

- Descriptions of what the UI now looks like or does. I will see it.
- A restatement of my request back to me.
- A list of files you changed. That is what the commit is for.
- A walkthrough of verification that passed exactly as expected. "All checks
  green" is one line, not a section.
- Narration of your own process, or of options you considered and dropped.
- Anything phrased to sound thorough rather than to tell me something.

**How to say it:**

- Plain English. Name a file, a command or a tool only when I would have to
  touch it myself, and then say in one short line what it is for.
- Lead with what changed for a person using the site, then what might still go
  wrong, then what I have to do.
- Being brief and being technical are not the same thing. Cut the words, keep
  the meaning. A sentence I have to re-read twice has not saved anyone time.

If the honest answer is "it works, nothing you need to know", then that plus the
one-line check result is the whole response. Short is correct when there is
nothing important; padding it hides the times there is.

## How to work

- **Verify before claiming.** Run it, measure it, read the log. Never report a
  behaviour you have not observed, and never present a plausible cause as a
  confirmed one — say which it is.
- **Find the root cause before fixing.** Symptom patches in this codebase have a
  history of moving the problem somewhere less visible.
- **Do not bundle.** One change per change. "While I was in there" is how an
  unrelated regression gets attributed to the wrong commit.
- **Match the surrounding code.** Comments here explain *why*, and the trap the
  decision avoids, not what the line does. Keep that.
- **Both locales, always.** `src/lib/i18n.ts` types the Persian dictionary as
  `typeof en`, so a missing key is a compile error — and `npm run i18n:missing`
  lists values still in English — but a poor translation passes both. RTL is a
  first-class layout, not a mirror.
- **`npm run lint`, `npm run typecheck` and `npm test` must all be clean**
  before you say you are finished. Add `npm run test:db` for anything touching
  SQL or `src/db/`, `npm run build` for anything touching a route segment, and
  `npm run audit:prod` when dependencies change. CI runs all of these; a red CI
  is not "finished".
- **Ask before anything that touches the live database, costs money, or
  deletes data.** Including `*:remote` scripts and `drizzle-kit push` against
  anything but local Docker.
- **Free Supabase plan, no backups:** every `db:migrate:remote` is preceded by `npm run db:backup:remote`.
- **Commands for me carry real values, never `<placeholders>`** — I paste them as written.
- `processCatalogImport` throws at `revalidatePath` outside Next *after* committing; integration tests treat that as success and assert the database.
- Do not move commits or uncommitted work between branches without asking.
- Commit or push only when asked.
- **`local-tools/` is local-only and not part of the app** (gitignored, never deployed, never imported). `node local-tools/usage-check/check.mjs` prints a read-only free-tier usage report (Vercel firewall traffic + live DB stats); a pasted report is your brief — act on its `[ACT]`/`[WATCH]` lines; past runs are in `local-tools/usage-check/logs/` (layout in its README).
- **Open follow-ups live in [`docs/FOLLOW-UPS.md`](docs/FOLLOW-UPS.md)** — read it before usage, crawler, caching or CI work; delete entries you finish.
- **Every family-page request is a database read** (the route reads `searchParams`, so nothing is cached) — the main Supabase-egress lever. Anything that makes it crawlable per URL (new query params, unfollowed links) needs a robots.txt line.
- **Plain `curl` to the live site gets `429 x-vercel-mitigated: challenge`** (Bot Protection is on Challenge); look at live pages in the built-in browser.
- **Vercel Hobby firewall:** 3 custom rules (2 used), 10 IP blocks (full), traffic data only for the last 24h (`npx vercel@latest firewall traffic list|inspect`; global `vercel` is too old); rule edits are staged until `vercel firewall publish`.
- **Keep this file current.** When you discover a non-obvious convention,
  gotcha, or command, propose a CLAUDE.md update at task end. Keep entries one
  line. Don't add what's obvious from code.

## Product direction (decided, not yet built)

- **Finance in the site means order money, not bookkeeping** — receipts, outstanding invoices, rep payouts, matching the bank's Excel statement against payments. Ledger, tax filings and payroll stay in the accountant's own software; the site helps it, never replaces it.
- **Staff get named accounts with roles, behind one sign-in** — new departments are a role plus its tabs, never a separate site; reps fold in. Until it ships, the shared admin password is also the sales engineer's login, so weigh who can reach any new staff feature.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
