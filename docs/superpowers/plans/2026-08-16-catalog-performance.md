# Catalog performance: what is actually slow, and the plan

Written 2026-08-16, from measurements against the live database, the production
build, and Vercel's production logs. Every number here was measured, not
estimated; where something was tried and did not help, that is recorded too.

## What was measured

**The biggest family page** (`socket-head-cap-screws`, 2,400 products),
production build, local:

| | |
| --- | --- |
| Server render | 906 ms |
| Transferred (gzip) | 1.88 MB |
| HTML decoded | 13.5 MB |
| DOM nodes | 113,809 |
| JS heap | 56 MB |
| `domInteractive` | 963 ms (fast laptop, no network) |
| Add-to-cart islands hydrated | 4,800 |

**The database is not the problem.** `products` is 40 MB and
`product_spec_values` 28 MB — trivial sizes. Execution times on the live
instance: the category page's family query **0.19 ms**, the 2,400-row product
fetch **108 ms**. Function region (`fra1`) and database region
(`eu-central-1`) match, so there is no cross-continent round trip.

The high means in `pg_stat_statements` (238 ms, 321 ms) are cumulative since
the last reset and are inflated by the 8–15 August outage window. They are not
current behaviour.

## The three real causes

### 1. Every family page is rendered twice, and half is never seen

The desktop table and the mobile card list are both rendered from the same data
and one is hidden with CSS. Of the 113,809 DOM nodes above, **exactly half are
the layout the visitor cannot see**, and 2,400 of the 4,800 add-to-cart islands
can never be interacted with.

This was a deliberate trade, documented in the README: rendering one layout per
request would break resizing a desktop window to check the phone view, which is
how this project gets reviewed. That trade was made when a page was 100 rows.
At 2,400 it costs ~940 KB of gzip and ~57,000 DOM nodes per view.

### 2. Category pages are not cached at all

`src/app/[locale]/c/[...slug]/page.tsx` exports `revalidate = 3600`, and the
README describes the route as ISR. **It is neither.** The page reads
`searchParams` (`view`, `page`), which opts the whole route into dynamic
rendering — the build output classifies it `ƒ (Dynamic)`, and Vercel's
production logs show `cache=MISS` on every single request.

This is the most-visited route on the site (55 requests in the last 24 hours,
more than every other route combined). Each one is a full render plus roughly
five database queries, to produce a page whose content changes when an
administrator edits the catalog and at no other time.

### 3. The unpagination is what made the largest families heavy

Removing the 100-row page limit was right — the facets and find-in-page cannot
see page 9 — but it turned the largest families into 1.9 MB pages. This is the
cause the site owner correctly guessed. The fix is not to undo it but to stop
paying for it twice (cause 1) and to bound the extreme case.

## Images: a real risk, not yet realised

Today **1 of 97 categories, 5 of 109 families and 0 of 35,743 products** carry
an image, so images are not part of the current slowness. They would become the
dominant cost if the catalog is populated, because `CatalogImage` renders a raw
`<img>`:

- No resizing. The one real external image is a 650×975 WebP, 48.8 KB, painted
  into a **34 px** tile. That is roughly 40× more pixels than the tile uses.
- No format negotiation and no Vercel optimisation — deliberately, because
  administrators can paste arbitrary supplier hosts that cannot be predeclared.
- Uploads are accepted up to **5 MB**, stored as-is, and served as-is. One 5 MB
  photo in an 88 px tile is 5 MB on the wire for about 8 KB of visible pixels.
- A category page paints ~25 tiles (subcategories plus family cards). Fully
  populated at supplier sizes that is tens of megabytes for one page.
- `ProductCardList` renders one image per card, so an unpaginated family would
  carry 2,400 `<img>` elements. They are `loading="lazy"`, so most are never
  fetched, but they are still DOM.

## Plan

Ordered by measured value per unit of risk. Each step is independently
shippable and independently verifiable.

### Step 1 — Cache the category pages — **done**

Two things were wrong, not one.

`searchParams` was the first. Next's prerenderer throws to interrupt static
generation the moment a legacy (non-PPR) render awaits it, and sets the
render's revalidate to 0. The `Suspense` pattern this plan originally proposed
only works with `cacheComponents: true`, which is a project-wide rendering
change and far too large a hammer for one route — so the list view moved to
`/[locale]/l/[…]` instead and the category page now reads no search params at
all. `?view=list` redirects to it, so shared links still work. It is `/l/`
rather than `/c/…/list` because a catch-all has to be a route's last segment.

That alone did not fix it. **A dynamic segment with no `generateStaticParams`
is served `no-store` and re-rendered per request regardless of `revalidate`.**
The route now declares the ten top-level categories; everything deeper is
generated on first request and cached from then on.

*Measured, production build:*

| | Before | After |
| --- | --- | --- |
| `/en/c/sealing` | `no-store`, rendered every request | `x-nextjs-cache: HIT`, **2.6 ms** |
| A category not prerendered | same | MISS once (108 ms), HIT after |
| `Cache-Control` | `private, no-cache, no-store` | `s-maxage=3600, stale-while-revalidate` |

### Step 1 (original wording, for reference)

Move the `view` / `page` reading out of the statically rendered path so the
default category view prerenders and is served from the CDN, with the
"list of products" view kept dynamic behind a `Suspense` boundary (the pattern
Next documents for exactly this). Keep `revalidate = 3600`.

*Verify:* build output shows the route is no longer `ƒ`; production logs show
`cache=HIT` after the first request.

*Risk:* low. No visual change. The admin revalidation path already targets this
route, so edits still publish.

### Step 2 — Render one layout per family page, not two — **done**

Option 1 from the list below: one markup, two layouts in CSS. The family page
renders only the table now, and below `lg` the stylesheet folds those same
`<tr>` elements into cards. `ProductCardList` stays — the category list view
still uses it, and there it earns its keep, because each row belongs to a
different family.

The obstacle named below turned out to be smaller than it looked. The card's
summary — *the specs that vary across these rows* — cannot be derived from a
single row's cells, so it is computed once for the page and rendered into one
extra cell per row (`data-cell="card"`), hidden on desktop. That duplicates a
few short values rather than the entire product, which is what the parallel
card list was duplicating. The logic moved to `src/lib/cardSummary.ts` so the
table and the list view cannot drift apart.

*Measured, production build, the 2,400-product family:*

| | Before | After |
| --- | --- | --- |
| DOM nodes | 113,809 | **79,602** |
| Add-to-cart islands | 4,800 | **2,400** |
| Transferred (gzip) | 1.88 MB | **1.43 MB** |
| HTML decoded | 13.5 MB | **8.7 MB** |
| Server render | 906 ms | **722 ms** |
| `domInteractive` | 963 ms | **755 ms** |

The 1,374-product family fell from 1.22 MB to 958 KB on the wire.

Nodes fell 30% rather than the 50% this plan predicted: a card was always
cheaper in nodes than a fifteen-cell table row, so the two layouts were never
an even split. The island count, which is what actually costs hydration time,
did halve.

One deliberate visual change: the phone card on a family page no longer repeats
the family thumbnail on every row. Every row on that page is the same family,
the header already shows the image at 64 px, and it was 2,400 identical
pictures. The category list view keeps its per-row image, because there the
family differs from row to row and the image is doing work.

### Step 2 (original wording, for reference)

The honest options, in order of preference:

1. **One markup, two layouts in CSS.** Style the existing `<tr>` rows into
   cards below `lg` with grid, and delete the parallel card markup. Halves DOM
   and payload, keeps resize-to-check working, no user-agent sniffing. Costs
   the most work: the card summary deliberately shows *the specs that vary
   across the visible rows*, which is computed per page and has no equivalent
   in the table markup, so that logic has to move or be dropped.
2. **Ship the table only, and mount the card list on the client below `lg`.**
   Simpler, but a phone gets nothing until JavaScript runs, which is a real
   regression on the connection this site is aimed at.

Option 1 is the one to build. It is the single largest measured win on the
page: ~57,000 DOM nodes and ~940 KB of gzip per view.

*Verify:* the same measurement table above, re-run.

### Step 3 — Bound the extreme families

2,400 rows is the current worst case; nothing stops a supplier file making it
10,000. Add a ceiling — render the first N rows and a plain "show the rest"
control that appends the remainder — chosen so the common case (under ~800
rows, which is every family but four) is unaffected and unbounded growth cannot
take the page down. This deliberately keeps find-in-page working for the sizes
people actually browse.

*Verify:* page weight for the four largest families, before and after.

### Step 4 — Make images cheap before the catalog gets them — **done**

Done differently from the plan below, and more cheaply.

The plan proposed resizing on upload and storing a small derivative. That
solves storage, which is not the problem — bandwidth and paint time are — and
it needs an image library in the write path. Serving every picture through
Next's image optimiser solves the actual problem with no new dependency:
`sharp` already ships inside Next 16, so both the Vercel and the Docker
`standalone` paths have it. Originals stay whatever size they were uploaded at,
which is fine, because nobody downloads them.

`CatalogImage` renders `next/image` for HTTPS sources, with `sizes` set to the
tile's own width — these thumbnails never reflow, so a viewport expression
would only mislead the optimiser into serving something larger. An `http:`
source still renders a plain `<img>`: `remotePatterns` is HTTPS-only, and an
insecure image is worth serving unoptimised rather than failing the render.

*Measured* on the one real external image in the catalog, a 650×975 WebP
painted into a 34px tile:

| | |
| --- | --- |
| Original | 48,828 B |
| Served | **2,686 B** WebP, natural size 34×51 |
| Saving | **95%** |

A fully-populated category page paints ~25 tiles: ~1.2 MB of supplier files
becomes ~67 KB. Against a 5 MB upload the ratio is far steeper.

**`remotePatterns` allows `hostname: "**"`, and that is a deliberate trade.**
Administrators paste arbitrary supplier URLs — that is the feature — so the
host cannot be enumerated in advance, and the alternative is that pasted images
stay unoptimised, which is exactly the case in the catalog today. The cost is
that the optimiser will fetch any HTTPS URL an admin enters, and each distinct
image and size is a billable transformation. Both are bounded by who can reach
`/admin`.

The 5 MB upload ceiling is unchanged. It now costs storage rather than
bandwidth, and storage is cheap.

### Step 4 (original wording, for reference)

Do this **before** the client uploads two hundred pictures, because retrofitting
means re-uploading them.

- Resize on upload: store a catalog-sized derivative (roughly 256 px) rather
  than the original 5 MB file, and serve that everywhere a tile is painted.
- Serve uploaded images through Vercel's image optimisation, which is available
  for the Supabase storage host because it *is* predeclarable — only pasted
  third-party URLs are not.
- Keep the raw `<img>` fallback for arbitrary external hosts, but add explicit
  `sizes`, and consider refusing hosts that do not send a cacheable response.

*Verify:* bytes transferred for a fully-populated category page, before and
after, with a representative 5 MB source photo.

### Step 5 — Drop indexes nothing reads — **cancelled, the analysis was wrong**

The premise was that `psv_family_key_num_idx` (8.7 MB) and
`product_spec_values`' primary key (5.6 MB) had never been scanned on
production. They had not — but `idx_scan = 0` there measures *which features
visitors have used*, not whether an index earns its keep.

Checked against the local database, which has been exercised properly:
`psv_family_key_num_idx` has **12 scans**. It serves numeric spec filtering;
production's zero means nobody has yet filtered by a numeric spec on the demo,
and dropping it would make that slow the first time someone does. The other is
a **primary key** — it enforces one row per `(product_id, spec_key)`, so it is
a correctness guarantee that happens to be an index, not an index.

Nothing to do. Recorded because the production `idx_scan` figure is genuinely
misleading and someone will find it again.

### Also done — import ceilings raised to 20,000 rows

Not part of the original performance plan; requested alongside it, and it
touches the same limits.

`MAX_ROWS` 5,000 → **20,000**, `MAX_BYTES` 2 MB → **24 MB**, and
`serverActions.bodySizeLimit` 6 MB → **32 MB**, because the CSV travels as a
form field and is posted twice (analyze, then confirm). The admin panel layout
now sets `maxDuration = 300`, overriding the 60 s ceiling the public site
carries: a public page taking 60 s is broken, an import taking two minutes is
working.

*Measured* on a generated 20,000-row × 13-column file (4.9 MB): analyze 92 ms,
parse 142 ms, **write 2.86 s**, all rows inserted, no errors. The widest real
family averages 631 B/row, so 20,000 rows there is ~12.6 MB — inside the 24 MB
ceiling with room over.

This also removes the trap in splitting a large family across files: there is
no longer a reason to split at 5,000, so no second file that has to remember to
use `update` mode or lose the first half.

## Tried and rejected

**`content-visibility: auto` on table rows.** The obvious cheap win: let the
browser skip layout and paint for offscreen rows. Measured on the 2,400-row
table at 1440 px — forced layout was 90–123 ms before and 91–167 ms after, and
the table's height did not change by a single pixel. No effect on a
`table-row`; not worth the line of CSS. Recorded so nobody tries it twice.
