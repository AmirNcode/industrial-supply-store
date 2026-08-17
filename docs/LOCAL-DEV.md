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

**4. Bootstrap the empty local database.**

```bash
npm run db:bootstrap:local
```

This local-only command creates the schema, restores the search indexes,
invoice sequence and RLS, records every forward migration in the migration
ledger, and generates the demo catalog. It refuses remote targets. Seeding is
deterministic, so bookmarks and screenshots keep working across a rebuild.

**5. Start the site.**

```bash
npm run dev
```

Runs Next.js on your Mac, connecting to the container over port 5434. Open
<http://localhost:3000>; it redirects to `/en`, and Persian is at `/fa`. Admin
is at `/en/admin` with the password from `ADMIN_PASSWORD` in `.env`, defaulting
to `changeme` in development.

Leave this running. It watches your files and reloads on save.

The Docker service here is PostgreSQL only, not the full Supabase platform.
Everything except catalog file uploads works with that local database alone.
To exercise the 24 MB CSV-import flow, configure the Supabase URL, a
publishable/anon key, the server secret, and a distinct private import bucket as
shown in `.env.example`; the browser then uploads directly to Supabase Storage.

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

**"Another next dev server is already running."** Next.js allows one dev server
per directory, so this means an older one is still alive — usually one you
started days ago in a terminal tab you have since closed. The message names the
PID and offers `kill <pid>`, which works, but it is worth seeing what you are
killing first:

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
```

That prints whatever is listening on port 3000. To confirm it is this project
and not something else of yours, ask the process where it is running from and
how long it has been up — substituting its PID:

```bash
lsof -a -p <pid> -d cwd -Fn | grep '^n' | sed 's/^n//' && ps -p <pid> -o lstart,etime
```

`cwd` is the working directory, so if that prints this repo's path, it is a
stale server for this project and safe to stop. `etime` is how long it has been
running, in `days-hh:mm:ss`. Then kill the **parent** — the `next dev` launcher
— and the worker goes with it:

```bash
kill <parent-pid>
```

`ps -p <pid> -o ppid=` gives you the parent's PID. Killing only the worker can
leave the launcher behind to respawn it.

A stale dev server is worth clearing rather than working around on another
port: it is serving the code as it was when it started, so you can spend a while
wondering why an edit has no effect.

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
code. Apply the pending forward migrations:

```bash
npm run db:migrate
```

**The site is slow, or you suspect emulation.** Run the three ARM64 checks
above. Genuine emulation shows up as `x86_64` from `uname -m` inside the
container.

**You want to start completely fresh.** This deletes all local data and rebuilds
it from scratch in about twenty seconds:

```bash
docker compose down -v
docker compose up -d db
npm run db:bootstrap:local
```

---

## Running the whole site in Docker

Rarely useful, but it exists — it is how you check that the production image
actually builds. The app image prerenders the home page during the build, so the
database must be up *and seeded* before you build it, or the build fails on an
empty catalog:

Set `AUTH_SECRET` and `DOCKER_BUILD_DATABASE_URL` in `.env`, then:

```bash
docker compose up -d db
npm run db:bootstrap:local
docker compose --profile full up -d --build
```

The Docker build receives the database URL and signing key as ephemeral
BuildKit secrets. At runtime the signing key is mounted as a Compose secret
file; no `.env*` file is sent in the build context.

If you also exercise catalog image or CSV uploads from the container, set the
Supabase Storage variables from `.env.example`. Compose forwards both the
server-only secret and the browser-safe publishable/anon key; only the latter is
returned with a path-specific signed CSV upload token.

`--profile full` is what opts the `app` service in; without the flag Compose
ignores it entirely, which is why step 2 above only ever starts the database.
The site then runs on <http://localhost:3000> from inside the container, and
code changes require a rebuild — hence `npm run dev` for day-to-day work.

Note that this path is local-only. Vercel ignores the `Dockerfile` and builds
Next.js natively, so a working image proves the app builds, not that the deploy
will.
