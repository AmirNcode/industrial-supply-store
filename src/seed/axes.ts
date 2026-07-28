import type { Axis } from "./types";
import { range, fractionalInches } from "./generate";

/** Terse axis constructor — the taxonomy declares hundreds of these. */
export function ax(
  key: string,
  labelEn: string,
  labelFa: string,
  values: (string | number)[],
  opts: Partial<Pick<Axis, "unit" | "kind" | "filterable">> = {},
): Axis {
  return { key, labelEn, labelFa, values, ...opts };
}

// --- Reusable value pools --------------------------------------------------

export const ELASTOMERS = [
  "Buna-N",
  "Viton",
  "Silicone",
  "EPDM",
  "Neoprene",
  "PTFE",
  "Polyurethane",
];

export const HARDNESS = [
  "Durometer 50A (Soft)",
  "Durometer 70A (Medium)",
  "Durometer 90A (Hard)",
];

export const FASTENER_MATERIALS = [
  "18-8 Stainless Steel",
  "316 Stainless Steel",
  "Alloy Steel",
  "Zinc-Plated Steel",
  "Black-Oxide Steel",
  "Brass",
  "Nylon",
  "Titanium",
];

export const STRUCTURAL_MATERIALS = [
  "Low-Carbon Steel",
  "18-8 Stainless Steel",
  "316 Stainless Steel",
  "6061 Aluminum",
  "Brass",
  "Copper",
  "Cast Iron",
];

export const PLASTICS = [
  "Nylon 6/6",
  "Acetal",
  "UHMW",
  "Polypropylene",
  "PVC",
  "Polycarbonate",
  "Acrylic",
  "PTFE",
  "PEEK",
];

export const FINISHES = [
  "Plain",
  "Zinc Plated",
  "Black Oxide",
  "Passivated",
  "Hot-Dipped Galvanized",
];

export const COLORS = ["Black", "White", "Red", "Blue", "Green", "Yellow", "Clear"];

/** Unified National Coarse thread sizes, small to large. */
export const UNC_THREADS = [
  "#0-80", "#1-64", "#2-56", "#4-40", "#6-32", "#8-32", "#10-24", "#10-32",
  "1/4\"-20", "5/16\"-18", "3/8\"-16", "7/16\"-14", "1/2\"-13", "9/16\"-12",
  "5/8\"-11", "3/4\"-10", "7/8\"-9", "1\"-8", "1 1/4\"-7", "1 1/2\"-6",
];

export const METRIC_THREADS = [
  "M1.6 x 0.35", "M2 x 0.4", "M2.5 x 0.45", "M3 x 0.5", "M4 x 0.7", "M5 x 0.8",
  "M6 x 1", "M8 x 1.25", "M10 x 1.5", "M12 x 1.75", "M14 x 2", "M16 x 2",
  "M20 x 2.5", "M24 x 3", "M30 x 3.5",
];

/** Nominal pipe sizes, NPS. */
export const PIPE_SIZES = [
  "1/8\"", "1/4\"", "3/8\"", "1/2\"", "3/4\"", "1\"", "1 1/4\"", "1 1/2\"",
  "2\"", "2 1/2\"", "3\"", "4\"", "5\"", "6\"", "8\"",
];

export const SCREW_LENGTHS_IN = [
  0.125, 0.1875, 0.25, 0.3125, 0.375, 0.5, 0.625, 0.75, 0.875, 1, 1.25, 1.5,
  1.75, 2, 2.5, 3, 3.5, 4, 5, 6,
];

export const METRIC_LENGTHS_MM = [
  3, 4, 5, 6, 8, 10, 12, 14, 16, 18, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 100,
];

/** Standard metric bearing bore diameters, mm. */
export const BEARING_BORES = [
  3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 17, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65,
  70, 75, 80, 90, 100,
];

export const TEMP_RANGES_F = [
  "-20 to 250",
  "-40 to 225",
  "-60 to 400",
  "-15 to 400",
  "-100 to 500",
  "0 to 200",
];

/**
 * Service temperature is a property of the material, not an independent choice.
 * Making it an axis would multiply out rows that differ only by a number the
 * buyer cannot actually select — so it is derived from `material` instead.
 */
export const MATERIAL_TEMP: Record<string, string> = {
  "Buna-N": "-20 to 250",
  "Soft Buna-N": "-20 to 250",
  "Hard Buna-N": "-20 to 250",
  Nitrile: "-20 to 250",
  HNBR: "-40 to 300",
  Viton: "-15 to 400",
  Silicone: "-60 to 400",
  Fluorosilicone: "-70 to 350",
  EPDM: "-40 to 275",
  Neoprene: "-30 to 250",
  PTFE: "-100 to 500",
  Polyurethane: "-40 to 200",
  Rubber: "-20 to 200",
  PVC: "0 to 150",
  Polyethylene: "-60 to 180",
};

export function tempForMaterial(material: unknown): string {
  return MATERIAL_TEMP[String(material)] ?? "-20 to 250";
}

/**
 * Nominal major diameter, inches, for the thread designations used above.
 * Needed to derive across-flats and head dimensions that would otherwise be
 * parsed out of the label string and get sizes like "1/4-20" wrong.
 */
export const THREAD_NOMINAL_IN: Record<string, number> = {
  "#0-80": 0.06, "#1-64": 0.073, "#2-56": 0.086, "#4-40": 0.112,
  "#6-32": 0.138, "#8-32": 0.164, "#10-24": 0.19, "#10-32": 0.19,
  '1/4"-20': 0.25, '5/16"-18': 0.3125, '3/8"-16': 0.375, '7/16"-14': 0.4375,
  '1/2"-13': 0.5, '9/16"-12': 0.5625, '5/8"-11': 0.625, '3/4"-10': 0.75,
  '7/8"-9': 0.875, '1"-8': 1, '1 1/4"-7': 1.25, '1 1/2"-6': 1.5,
};

export function threadNominal(thread: unknown): number {
  const t = String(thread);
  if (THREAD_NOMINAL_IN[t] !== undefined) return THREAD_NOMINAL_IN[t];
  // Metric: "M12 x 1.75" -> 12 mm expressed in inches.
  const m = t.match(/^M([\d.]+)/);
  if (m) return Number(m[1]) / 25.4;
  return 0.25;
}

// --- Common axis shortcuts -------------------------------------------------

export const materialAxis = (values: string[] = FASTENER_MATERIALS) =>
  ax("material", "Material", "جنس", values);

export const finishAxis = (values: string[] = FINISHES) =>
  ax("finish", "Finish", "پوشش", values);

export const colorAxis = (values: string[] = COLORS) =>
  ax("color", "Color", "رنگ", values);

export const tempAxis = (values: string[] = TEMP_RANGES_F) =>
  ax("temp", "Temp. Range, °F", "بازه دما (°F)", values, { filterable: false });

export const lengthInAxis = (values: number[] = SCREW_LENGTHS_IN) =>
  ax("length", "Length", "طول", values, { unit: '"', kind: "number" });

export const odAxis = (values: number[], unit = '"') =>
  ax("od", "OD", "قطر خارجی", values, { unit, kind: "number" });

export const idAxis = (values: number[], unit = '"') =>
  ax("id", "ID", "قطر داخلی", values, { unit, kind: "number" });

export const thicknessAxis = (values: number[], unit = '"') =>
  ax("thickness", "Thickness", "ضخامت", values, { unit, kind: "number" });

export const widthAxis = (values: number[], unit = '"') =>
  ax("width", "Width", "عرض", values, { unit, kind: "number" });

export { range, fractionalInches };
