# Running this locally on a MacBook

A cheat sheet for starting the site on an Apple Silicon Mac, with an
explanation of what each command actually does. The terse version lives in the
README; this one is for when you want to know *why*, or when something is
broken and you need to work out which piece.

## The mental model

Only **one thing runs in Docker: the database.** Everything else — Next.js, the
seeder, the migration scripts — runs directly on macOS with Node.

That split is deliberate. Postgres wants a fixed version, a fixed locale and a
disk that survives reboots, which is exactly what a container is good at.
Next.js in a container would mean rebuilding an image on every code change, so
it stays on the host where `npm run dev` reloads in milliseconds.

```
  macOS (your machine)                    Docker
  ┌──────────────────────────┐            ┌─────────────────────────┐
  │  npm run dev             │            │  container: isupply-db  │
  │  Next.js on :3000        │──────────► │  Postgres 17 on :5432   │
  │                          │  port 5434 │  volume: isupply-pgdata │
  │  npm run db:seed         │            └─────────────────────────┘
  │  npm run db:column-tiers │
  └──────────────────────────┘
```

There *is* a second container (`app`) that runs the whole site in Docker, but it
is behind an opt-in profile and you almost never want it. See the bottom.

---

## Starting from cold

Run these in order from the repo root. Steps 3 and 4 are one-time on a fresh
database; after that your daily start is steps 1, 2 and 6.

**1. Make sure Docker Desktop is running.**

```bash
docker info > /dev/null 2>&1 && echo "Docker is up" || echo "Start Docker Desktop"
```

Docker Desktop is the background service that runs containers. `docker info`
asks it a question; if it answers, it is running. Nothing else on this page
works until this prints "Docker is up" — open Docker Desktop from Applications
and wait for the whale icon in the menu bar to stop animating.

**2. Start the database container.**

```bash
docker compose up -d db
```

Reads `docker-compose.yml`, finds the service named `db`, and starts it.

- `up` means "create and start it if it isn't already; leave it alone if it is."
- `-d` means *detached* — run in the background and give you the prompt back.
  Without it, the container's logs take over your terminal and Ctrl-C stops the
  database.
- `db` is the service name from the compose file. Omit it and Compose starts
  every service that isn't behind a profile.

This is safe to run when the container is already up; it just says "Running".

**3. Confirm it is actually ready to accept connections.**

```bash
docker compose ps
```

Look for `isupply-db` with status `Up ... (healthy)`. "Healthy" is stronger than
"Up": the compose file defines a health check that runs `pg_isready` every three
seconds, so `healthy` means Postgres has finished starting and is answering
queries. A fresh container spends a few seconds at `(health: starting)` while it
initialises the data directory — connecting during that window fails with
"connection refused", which looks alarming and simply means you were early.

**4. Create the tables.**

```bash
npm run db:push
```

Reads `src/db/schema.ts` and makes the real database match it. Then it
automatically re-applies `src/db/extensions.sql`, which restores the search
indexes, the invoice sequence and row-level security — things `drizzle-kit push`
deletes every time it runs because it cannot see them in the schema file. That
re-apply is why you run the npm script and never bare `drizzle-kit push`.
`docs/DEPLOYMENT.md` has the full story; it has bitten this project four times.

**5. Fill it with data.**

```bash
npm run db:seed
```

Generates about 34,000 demo products across 97 categories. Takes roughly 14
seconds. It is deterministic — reseeding produces byte-identical part numbers,
so your bookmarks and screenshots keep working.

**6. Start the site.**

```bash
npm run dev
```

Runs Next.js on your Mac, connecting to the container over port 5434. Open
<http://localhost:3000>; it redirects to `/en`, and Persian is at `/fa`. Admin
is at `/en/admin` with the password from `ADMIN_PASSWORD` in `.env`, defaulting
to `changeme` in development.

Leave this running. It watches your files and reloads on save.

---

## Making sure it is ARM64 and not emulating Intel

Your Mac has an Apple Silicon chip, which is the ARM64 architecture. Docker
images are built per architecture, so an image built for Intel (AMD64) can only
run on your machine through emulation — translating every Intel instruction into
ARM instructions as it goes. It works, but it is typically several times slower
and occasionally subtly wrong, so it is worth knowing which you are on.

Three checks, cheapest first.

**Check 1 — what the container thinks it is running on.** The most direct
answer, because it asks the process itself:

```bash
docker exec isupply-db uname -m
```

Expect `aarch64`. That is the Linux name for ARM64 — same thing, different
spelling. If you see `x86_64`, you are emulating.

**Check 2 — what the image was built for.**

```bash
docker image inspect postgres:17-alpine --format '{{.Os}}/{{.Architecture}}'
```

Expect `linux/arm64`. `linux/amd64` means Docker pulled the Intel build.

**Check 3 — sweep every image you have.** Useful once in a while:

```bash
docker images --format '{{.Repository}}:{{.Tag}}' | grep -v '<none>' | while read i; do a=$(docker image inspect "$i" --format '{{.Architecture}}' 2>/dev/null); [ "$a" != "arm64" ] && echo "$i -> $a"; done
```

Anything it prints is a non-ARM image. On your machine today this prints two old
`bj-erp-app` images tagged `amd64` — those belong to a different project, which
also has `-local-arm64` builds it actually runs, so they are just stale leftovers
and nothing to do with this repo.

**Where emulation creeps in.** There are only really three causes, and none of
them happen by accident:

1. A `platform: linux/amd64` line in a compose file. This repo has none — worth
   re-checking after you pull someone else's branch:
   ```bash
   grep -rn "platform" docker-compose*.yml || echo "no platform pins (good)"
   ```
2. A `--platform linux/amd64` flag on a `docker run` or `docker build`.
3. The image genuinely has no ARM64 build, so Docker falls back to Intel and
   prints a warning when it pulls. `postgres` publishes ARM64, so this is not a
   problem here.

**Your current status is clean.** Postgres itself reports it, which is the least
deniable evidence available:

```bash
docker exec isupply-db psql -U isupply -d isupply -tAc "select version();"
```

Today this returns `PostgreSQL 17.10 on aarch64-unknown-linux-musl` — `aarch64`
in the build target means the binary is native ARM.

---

## The port trap on this machine

The compose file publishes the database on host port **5433**. On your Mac that
port is already taken by an unrelated project's container (`bj-erp-db-1`), so
there is a `docker-compose.override.yml` that moves it to **5434**.

Compose reads `docker-compose.override.yml` automatically if it exists and
merges it over the main file — that is a built-in convention, not something
configured here. The override is in `.gitignore` because the clash is specific
to your machine; a teammate without `bj-erp` running would use 5433.

So on this Mac the real address is `localhost:5434`, and `.env` sets
`DATABASE_URL` to match. **If you ever delete `.env`, the app falls back to the
5433 default baked into `src/db/index.ts` and connects to the wrong project's
database** — or fails outright. Confirm what is actually published:

```bash
docker compose port db 5432
```

That asks "what host address is the container's port 5432 published on?" and
should print `0.0.0.0:5434`. It should always agree with the port in `.env`.

---

## Everyday commands

| What you want | Command |
|---|---|
| Start the database | `docker compose up -d db` |
| Is it up and healthy? | `docker compose ps` |
| Stop it, keep the data | `docker compose stop db` |
| Stop and remove the container, keep the data | `docker compose down` |
| **Delete the data too** | `docker compose down -v` |
| Watch the database logs | `docker compose logs -f db` |
| Open a SQL prompt | `docker exec -it isupply-db psql -U isupply -d isupply` |
| Run one SQL statement | `docker exec isupply-db psql -U isupply -d isupply -c "select count(*) from products;"` |
| Wipe and rebuild the data | `npm run db:reset` |

Two of those deserve a note.

`stop` versus `down`: **stop** pauses the container and leaves it there, so
starting again is instant. **down** deletes the container but keeps the named
volume `isupply-pgdata`, where the actual database files live — so your data
survives, and the next `up` builds a fresh container around the same disk. The
`-v` flag is the one that destroys the volume, and therefore the data. That is
the only command on this page you cannot undo.

`docker exec` means "run a command inside a container that is already running."
`-it` makes it interactive so you get a live `psql` prompt; leave it off when you
just want one query's output. Type `\q` to leave `psql`.

---

## When something is wrong

**"Connection refused" or "ECONNREFUSED" from the app.** The container is not
running, or you are on the wrong port. Check both:

```bash
docker compose ps && docker compose port db 5432 && grep DATABASE_URL .env
```

The port in the middle line must match the port in the last line.

**The container keeps restarting.** Read its logs — the reason is almost always
in the last twenty lines:

```bash
docker compose logs --tail 20 db
```

**"Port is already allocated" when starting.** Something else holds the host
port. Find out what:

```bash
docker ps --format '{{.Names}}\t{{.Ports}}' | grep 543
```

Then either stop that container or change the port in
`docker-compose.override.yml`, remembering to update `.env` to match.

**A query fails on a column that should exist.** Your database is older than the
code. Bring it up to date:

```bash
npm run db:push
```

On the `feature/dynamic-product-columns` branch specifically there is also a
targeted, additive migration that only adds the five new columns and touches
nothing else — safer than a full push when that is all you need:

```bash
npm run db:column-tiers
```

**The site is slow, or you suspect emulation.** Run the three ARM64 checks
above. Genuine emulation shows up as `x86_64` from `uname -m` inside the
container.

**You want to start completely fresh.** This deletes all local data and rebuilds
it from scratch in about twenty seconds:

```bash
docker compose down -v && docker compose up -d db && npm run db:push && npm run db:seed
```

---

## Running the whole site in Docker

Rarely useful, but it exists — it is how you check that the production image
actually builds. The app image prerenders the home page during the build, so the
database must be up *and seeded* before you build it, or the build fails on an
empty catalog:

```bash
docker compose up -d db && npm run db:seed && docker compose --profile full up -d --build
```

`--profile full` is what opts the `app` service in; without the flag Compose
ignores it entirely, which is why step 2 above only ever starts the database.
The site then runs on <http://localhost:3000> from inside the container, and
code changes require a rebuild — hence `npm run dev` for day-to-day work.

Note that this path is local-only. Vercel ignores the `Dockerfile` and builds
Next.js natively, so a working image proves the app builds, not that the deploy
will.
