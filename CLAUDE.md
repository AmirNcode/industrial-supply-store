# Working on this codebase

Instructions for Claude, or any other coding agent, working in this repository.
The technical orientation is [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md);
deployment and its traps are [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md); the
local setup is [`docs/LOCAL-DEV.md`](docs/LOCAL-DEV.md). Read those for *what
the code is*. This file is about *how to work and how to report*.

## How to report back

**Tell me only what I could not find out by opening the site and using it.**

I am going to open the page and click the thing. Anything I would see in the
first ten seconds of doing that is not worth a sentence. What I cannot see by
looking is what I need from you.

**Worth saying:**

- **What you could not verify, and why.** Especially anything gated behind the
  admin password — you do not type credentials, so say plainly which paths went
  unexercised rather than implying the whole feature is proven.
- **Where you deviated from what I asked, and the reason.** Including scope you
  deliberately did not take, so I can decide whether I want it.
- **Costs that only appear later**: page weight, query count, cache purges,
  function time, anything that is fine at 40 rows and hurts at 4,000. Give the
  measured number, not an adjective.
- **Anything that needs me to act**: a migration, an environment variable, a
  credential to rotate, a click only a signed-in human can make, a script to run
  before deploying.
- **Pre-existing bugs you find in passing.** Say so, do not fix them in the same
  change, and file them separately.
- **Platform or browser constraints you hit**, when they explain why the result
  is shaped the way it is rather than the way I asked for.
- **A real risk you are still carrying** after the change, stated once, without
  hedging language wrapped around it.

**Not worth saying:**

- Descriptions of what the UI now looks like or does. I will see it.
- A restatement of my request back to me.
- A list of files you changed — `git diff` already holds that, and better.
- A walkthrough of verification that passed exactly as expected. "Types clean,
  128/128 tests, build exit 0" is one line, not a section.
- Narration of your own process, or of options you considered and dropped.
- Anything phrased to sound thorough rather than to tell me something.

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
  `typeof en`, so a missing key is a compile error — but a lazy translation is
  not. RTL is a first-class layout, not a mirror.
- **`npx tsc --noEmit` and `npm test` must both be clean** before you say you
  are finished. `npm run build` too, for anything touching a route segment.
- Commit or push only when asked.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
