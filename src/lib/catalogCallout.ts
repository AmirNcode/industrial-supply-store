/**
 * The two rules the description callout needs, kept away from React and the
 * database so they can be tested on their own.
 *
 * Both are small, and both are the sort of rule that is wrong in a way nobody
 * notices: an image at the wrong size still renders, and a paragraph break that
 * silently disappears still reads as prose.
 */

/**
 * A real dimension diagram earns the space, in a landscape box.
 *
 * The box is reserved rather than shrink-wrapped, so the page never reflows
 * when the picture arrives. That means picking a shape before knowing the
 * image's: 3:2 landscape, because a dimension drawing is a part seen side-on
 * with a measurement across it, and almost every one of them is wider than it
 * is tall. A square box spends its extra height on nothing — measured at 375px,
 * a 3:1 drawing left roughly 170px of empty panel above the fold.
 */
export const DIAGRAM_SIZE = 240;

/**
 * The box the diagram is contained in, `240 x 160`.
 *
 * Tailwind needs the literals in the class strings, so `CatalogCallout` spells
 * both out; these constants are what the tests read, and the pair has to move
 * together if either changes.
 */
export const DIAGRAM_BOX_HEIGHT = 160;

/** Anything standing in for one stays a thumbnail. */
export const CALLOUT_THUMB_SIZE = 46;

export type CalloutArtSource = {
  diagramUrl: string;
  imageUrl: string;
  icon: string;
};

export type CalloutArt = {
  /** Empty when there is no picture at all and the SVG icon has to stand in. */
  imageUrl: string;
  icon: string;
  size: number;
  isDiagram: boolean;
};

/**
 * Which picture the callout paints, and how large.
 *
 * The size is the signal, not decoration. A diagram is the thing worth 240px;
 * a catalog photograph promoted to that size would duplicate the family
 * header's own image at four times the scale and assert that it explains a
 * measurement, which it does not. So a fallback stays a thumbnail — the reader
 * can see at a glance whether the picture is an explanation or a placeholder.
 */
export function calloutArt(source: CalloutArtSource): CalloutArt {
  if (source.diagramUrl) {
    return {
      imageUrl: source.diagramUrl,
      icon: source.icon,
      size: DIAGRAM_SIZE,
      isDiagram: true,
    };
  }
  return {
    imageUrl: source.imageUrl,
    icon: source.icon,
    size: CALLOUT_THUMB_SIZE,
    isDiagram: false,
  };
}

/**
 * Description text as paragraphs.
 *
 * A blank line starts a new paragraph; a single newline is a soft wrap and
 * collapses to a space, because a description pasted out of a supplier's
 * document arrives hard-wrapped at whatever width that document used and those
 * breaks mean nothing here.
 *
 * Deliberately not markdown. There is no renderer, no sanitiser, and no way for
 * a paste out of Word to produce anything but text on a public page.
 */
export function paragraphs(text: string): string[] {
  return text
    .split(/\r?\n[ \t]*\r?\n/)
    .map((block) => block.replace(/\s*\r?\n\s*/g, " ").trim())
    .filter((block) => block.length > 0);
}
