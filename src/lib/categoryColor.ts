/**
 * One hue per top-level category, worn as a 3px spine under its tile.
 *
 * Derived from the root slug rather than stored, so adding a category to the
 * taxonomy needs no colour bookkeeping. The palette is deliberately desaturated
 * and equal-weight: these are wayfinding marks, not status colours, and nothing
 * in the grid should look more important than its neighbours.
 */
const SPINES = [
  "#1c7a52", // green
  "#2f7fa8", // blue
  "#c8860d", // amber
  "#a8542f", // rust
  "#6b5ba8", // violet
  "#2f8f8a", // teal
  "#a82f5b", // magenta
  "#55702f", // olive
  "#8a6a2f", // bronze
  "#4a6fa8", // slate blue
];

export function categorySpine(path: string): string {
  const root = path.split("/")[0] ?? "";
  let h = 2166136261;
  for (let i = 0; i < root.length; i++) {
    h ^= root.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return SPINES[(h >>> 0) % SPINES.length];
}
