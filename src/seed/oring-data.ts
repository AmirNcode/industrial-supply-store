/**
 * AS568-style O-ring dimension table.
 *
 * The -0xx series inside diameters are the real standard values. The -1xx
 * through -4xx series are generated from each series' documented base size and
 * uniform increment (1/16", 1/8", 1/4"), which reproduces the correct shape and
 * magnitude of the standard without transcribing several hundred rows.
 *
 * This is seed data for interface testing. It is NOT a certified reference
 * table and must not be used to select a real sealing part.
 */

export type ORingSize = {
  dash: string;
  /** Inside diameter, inches. */
  id: number;
  /** Cross-section width, inches. */
  width: number;
};

const SERIES_0: number[] = [
  0.07, 0.101, 0.114, 0.145, 0.176, 0.208, 0.239, 0.301, 0.364, 0.426, 0.489,
  0.551, 0.614, 0.676, 0.739, 0.801, 0.864, 0.926, 0.989, 1.051, 1.114, 1.176,
  1.239, 1.301, 1.364, 1.489, 1.614, 1.739, 1.864, 1.989, 2.114, 2.239, 2.364,
  2.489, 2.614, 2.739, 2.864, 2.989, 3.239, 3.489, 3.739, 3.989, 4.239, 4.489,
  4.739, 4.989, 5.239,
];

function series(
  firstDash: number,
  count: number,
  firstId: number,
  step: number,
  width: number,
  /** Some series begin with a few irregular sizes before the uniform ladder. */
  head: number[] = [],
): ORingSize[] {
  const out: ORingSize[] = [];
  head.forEach((id, i) => {
    out.push({ dash: String(firstDash + i), id: round(id), width });
  });
  const base = firstDash + head.length;
  for (let i = 0; i < count; i++) {
    out.push({
      dash: String(base + i),
      id: round(firstId + i * step),
      width,
    });
  }
  return out;
}

function round(n: number): number {
  return Number(n.toFixed(3));
}

export const ORING_SIZES: ORingSize[] = [
  // -0xx: 1/16" cross section, dashes 004-050.
  ...SERIES_0.map((id, i) => ({ dash: pad(4 + i), id: round(id), width: 0.07 })),
  // -1xx: 3/32" cross section. Irregular head, then a 1/16" ladder.
  ...series(102, 41, 0.362, 0.0625, 0.103, [0.049, 0.081, 0.112, 0.143, 0.174, 0.206, 0.237, 0.299]),
  // -2xx: 1/8" cross section, 1/16" ladder.
  ...series(201, 60, 0.171, 0.0625, 0.139),
  // -3xx: 3/16" cross section, 1/8" ladder.
  ...series(309, 47, 0.481, 0.125, 0.21),
  // -4xx: 1/4" cross section, 1/4" ladder.
  ...series(425, 26, 4.475, 0.25, 0.275),
];

function pad(n: number): string {
  return n < 10 ? `00${n}` : n < 100 ? `0${n}` : String(n);
}

const BY_DASH = new Map(ORING_SIZES.map((s) => [s.dash, s]));

export function oringSize(dash: string): ORingSize | undefined {
  return BY_DASH.get(dash);
}

/** Dash numbers as axis values, optionally thinned to keep a family's size sane. */
export function dashValues(everyNth = 1): string[] {
  return ORING_SIZES.filter((_, i) => i % everyNth === 0).map((s) => s.dash);
}

/** Metric O-ring sizes, ISO 3601 style: ID x cross-section in mm. */
export const METRIC_ORING_IDS = [
  1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
  20, 21, 22, 23, 24, 25, 26, 28, 30, 32, 34, 35, 36, 38, 40, 42, 45, 48, 50,
  55, 60, 65, 70, 75, 80, 85, 90, 95, 100, 110, 120, 130, 140, 150,
];

export const METRIC_ORING_WIDTHS = [1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 5.5, 6];
