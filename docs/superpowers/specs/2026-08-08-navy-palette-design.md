# Navy palette

Replaces the pine-green palette with navy blue and white, flips the masthead
from near-black to white, and narrows gold to a single meaning.

## Why

The green palette was inherited from the first build and never argued for. Navy
reads as industrial supply rather than outdoors, and a white masthead puts the
brand mark on a neutral field instead of competing with a dark band behind it.

## Rules

These are the constraints the palette has to keep holding after this change.
Anything added later is measured against them.

1. **Navy is the only interactive colour.** If it can be clicked, it is navy.
   Nothing else in the palette is allowed to look clickable.
2. **Gold means money.** The price column wash, invoice totals, and the
   cart-count badge. Gold no longer appears in the masthead, in navigation, or
   on informational panels — seeing it should mean a number is a price.
3. **Part numbers are never coloured.** They are ink-coloured mono. Only the
   two cart tables render them as real links, and only those get a hover
   underline. This is a correction, not a preference: every other part number
   on the site was already a `<span>` wearing link blue.
4. **Green survives only where it is semantic.** The in-stock pill
   (`--color-ok`) and the ten category-tile spines. Neither is brand colour;
   both would lose meaning if flattened to navy.
5. **Warnings own their own tokens.** Admin notices and import mismatches use
   `--color-warn*`, not gold, so a warning never reads as a price.

## Tokens

Replacing the `pine` family:

| Token | Value | Used for |
| --- | --- | --- |
| `--color-navy` | `#12356b` | Buttons, links, focus, nav, headings |
| `--color-navy-deep` | `#0b2249` | Button hover, text on tints |
| `--color-navy-lift` | `#2a5db0` | Focus ring, tile and chip hover |
| `--color-navy-tint` | `#e8eef7` | Pills, selected chips, row hover |

The `chrome` family keeps its names and roles but is pulled from green-black to
blue-black. It no longer backs the masthead — only the spec-table header band,
the mobile drawer, and the cart badge's text colour.

| Token | Value |
| --- | --- |
| `--color-chrome` | `#0d1b33` |
| `--color-chrome-2` | `#16274a` |
| `--color-chrome-line` | `#2b3f66` |
| `--color-chrome-ink` | `#e6ebf3` |
| `--color-chrome-muted` | `#93a3c0` |

Neutrals keep their names and are re-pulled from green to blue, so the greys
belong to the navy rather than sitting slightly off it: `ink` `#14181f`,
`ink-muted` `#57606f`, `ink-faint` `#8b93a1`, `rule` `#d8dde5`, `rule-light`
`#eceff4`, `panel` `#f3f5f9`, `panel-alt` `#fafbfd`.

Gold keeps its hex values unchanged. `--color-amber-line` is renamed
`--color-warn-line`, because every place it was used turned out to be a notice
rather than money.

Deleted: `--color-pine`, `--color-pine-deep`, `--color-pine-lift`,
`--color-pine-tint`, `--color-part-link`, `--color-part-visited`.

## Masthead

Navy (`--color-navy`), with everything on it white or near-white. The one
exception is the gold cart count, which keeps its colour under rule 2.

A white masthead was tried first and rejected: it dissolved into the page, and
the brand's yellow wordmark on white read as an untrimmed image rather than a
mark. The navy band gives the wordmark a field to sit on.

Structure is a thin tagline strip over a single control row — wordmark, search,
then the contact line and the order/quick-order/account links. The wordmark used
to have its own branding line above the controls; moving it beside the search
took a whole row out, 96px down to 84px. The wordmark is set to the search
field's 35px so the two read as one control strip.

The tagline is 10px, 60% of the 17px it was, and keeps the top line. The contact
line and nav links are 15% larger than before (11px → 12.5px, 12px → 14px),
which is what closes the gap that used to sit above them: the right-hand block
is now tall enough to fill the row beside the search rather than float in it.

The 3px rule beneath goes lighter than the bar — the navy block already draws
its own edge against the page, so the rule is the highlight along that edge.

On phones the wordmark keeps its old place on the top line, beside the tagline.
Moving it next to the search was tried and reversed: at 375px it took ~91px of
the control row and left the search at 134px. Back on the top line the search
gets 225px.

The phone's order link and menu button both carry an explicit 35px height rather
than relying on `.tap`. `.tap` only exists under `(pointer: coarse)`, so on a
laptop narrowed to phone width it never applied, and the two controls sat at
whatever height their content gave them — which is what made the menu button
look low. The button is an SVG rather than a `☰` character for the same reason:
a glyph sits where the font puts it inside its line box, a path does not.
`.tap` still raises both to 44px on real touch hardware.

The mobile drawer goes a step *darker* than the masthead (`--color-navy-deep`).
Against a navy bar it has to separate downward; at the same value the two read
as one block and the menu looks like part of the header.

## Catalog button

Removed from the desktop and mobile mastheads. The wordmark directly above it
already links home on every page, and the drawer carries an "all categories"
entry. On a phone this returns roughly 70px to the search field. The
`catalogButton` dictionary key goes with it.

## In-cart row wash

Today a row already on the order is gold at 13% and hovering it turns pale
green — two hues, so both signals read. Rule 2 removes the gold and now both
want blue.

Resolution: an ordered row is `rgba(18, 53, 107, 0.13)`, and hovering it
*deepens* to `rgba(18, 53, 107, 0.20)` rather than switching hue. Plain rows
still hover to `navy-tint`. Monochrome, and still scannable down two hundred
rows.

## Reveal-on-scroll-up masthead

Phones only. A spec table runs to a couple of hundred rows, and reaching the
search or the order from halfway down meant scrolling all the way back to the
top. The bar now tucks away on a downward scroll and returns on an upward one.

Permanently sticky would have been simpler, but it spends ~90px of a phone
screen on chrome for the entire scroll; this spends it only when the gesture
says the user wants navigation.

`position: sticky`, not `fixed`. The header is a direct child of `body`, so its
containing block is the whole document and it has the full page to travel —
no spacer, no layout shift. (The mobile filter bar cannot do this: its wrapper
is exactly as tall as the bar, leaving sticky nowhere to go.)

Two guards keep it from flapping: movements under 6px are ignored as thumb
tremor, and it never hides inside the first 120px, where the bar is on screen
anyway. `scrollY` readings outside the document are discarded — iOS rubber-
banding produces them on the way back from an overscroll, and they are not
gestures.

`MastheadReveal` renders nothing and sets `data-hidden` on the `<header>` above
it. Wrapping the header in a client component was the first attempt and it
broke `next build`: the masthead contains `SearchBar`, which calls
`useSearchParams`, and a client component above that pulls the static-rendering
bailout up to the page root. Keeping the boundary below the markup leaves the
whole masthead server-rendered, and means scrolling never re-renders it.

`SearchBar` itself is wrapped in a `Suspense` boundary for the same reason —
`useSearchParams` in a component that appears on every page fails every
prerendered route without one. The fallback is the same form posting to the
same route rather than a spinner, so search works before hydration and nothing
moves when React swaps it.

## Search-hit row

The row matching a `?pn=` highlight was gold-washed, which rule 2 disallows, and
tinting it navy would make it identical to a hovered row. It gets `navy-tint`
plus a navy inset outline instead — the outline survives hover, so the hit stays
findable while the pointer moves over it.
