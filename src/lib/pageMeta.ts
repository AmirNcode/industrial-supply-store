/**
 * Search-result snippets for catalog pages.
 *
 * Until 2026-11-25 every page carried the site-wide title and description, so
 * Google showed the gate-valve page exactly as it showed the home page — and
 * tends to fold pages that look identical into one result. Each catalog page
 * now names what is on it; the layout's title template appends the brand.
 */

/**
 * Google cuts descriptions at roughly 155–160 characters; a sentence cut
 * mid-word reads as broken. Trim at the last word boundary and mark the cut.
 */
export const META_DESCRIPTION_MAX = 158;

export function clampDescription(text: string, max: number = META_DESCRIPTION_MAX): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,.;:،—-]+$/, "")}…`;
}

/** Fills `{name}`-style holes in a dictionary string. */
export function fillMeta(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (hole, key: string) => values[key] ?? hole);
}

/** A family's one-line description, without the full stop the template adds. */
export function familyDescription(template: string, desc: string, count: string): string {
  return clampDescription(fillMeta(template, { desc: desc.trim().replace(/[.。]+$/, ""), count }));
}
