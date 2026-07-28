import type { CategorySeed, FamilySeed, FamilyGen } from "./types";
import {
  ax,
  range,
  ELASTOMERS,
  HARDNESS,
  FASTENER_MATERIALS,
  STRUCTURAL_MATERIALS,
  PLASTICS,
  FINISHES,
  COLORS,
  UNC_THREADS,
  METRIC_THREADS,
  PIPE_SIZES,
  SCREW_LENGTHS_IN,
  METRIC_LENGTHS_MM,
  BEARING_BORES,
  TEMP_RANGES_F,
  materialAxis,
  finishAxis,
  colorAxis,
  tempAxis,
  tempForMaterial,
  threadNominal,
  lengthInAxis,
  idAxis,
  odAxis,
  thicknessAxis,
  widthAxis,
} from "./axes";
import { ORING_SIZES, oringSize, dashValues, METRIC_ORING_IDS, METRIC_ORING_WIDTHS } from "./oring-data";

/** Terse family constructor. */
function fam(
  slug: string,
  en: string,
  fa: string,
  descEn: string,
  descFa: string,
  gen: FamilyGen,
  extra: Partial<FamilySeed> = {},
): FamilySeed {
  return { slug, en, fa, descEn, descFa, gen, ...extra };
}

/** Terse category constructor. */
function cat(
  slug: string,
  en: string,
  fa: string,
  icon: string,
  rest: Partial<CategorySeed> = {},
): CategorySeed {
  return { slug, en, fa, icon, ...rest };
}

// ---------------------------------------------------------------------------
// O-rings — the flagship family, modelled in full detail
// ---------------------------------------------------------------------------

/**
 * ID and cross-section are functions of the dash number, so they are derived
 * columns rather than axes — otherwise the cartesian product would generate
 * thousands of dimensionally impossible combinations.
 */
/** Service temperature follows the material — see MATERIAL_TEMP. */
const tempDerived = {
  key: "temp",
  labelEn: "Temp. Range, °F",
  labelFa: "بازه دما (°F)",
  kind: "text" as const,
  filterable: false,
  compute: (s: Record<string, unknown>) => tempForMaterial(s.material),
};

const oringDerived = [
  {
    key: "width",
    labelEn: "Width",
    labelFa: "قطر مقطع",
    unit: '"',
    kind: "number" as const,
    filterable: true,
    after: "dash",
    compute: (s: Record<string, unknown>) => oringSize(String(s.dash))?.width ?? null,
  },
  {
    key: "id",
    labelEn: "ID",
    labelFa: "قطر داخلی",
    unit: '"',
    kind: "number" as const,
    filterable: true,
    after: "dash",
    compute: (s: Record<string, unknown>) => oringSize(String(s.dash))?.id ?? null,
  },
  {
    key: "od",
    labelEn: "OD",
    labelFa: "قطر خارجی",
    unit: '"',
    kind: "number" as const,
    filterable: true,
    after: "dash",
    compute: (s: Record<string, unknown>) => {
      const z = oringSize(String(s.dash));
      return z ? Number((z.id + 2 * z.width).toFixed(3)) : null;
    },
  },
];

function oringGen(
  materials: string[],
  hardness: string[],
  colors: string[],
  opts: { cap?: number; base?: number; everyNth?: number; spec?: string } = {},
): FamilyGen {
  return {
    axes: [
      ax("dash", "Dash No.", "شماره داش", dashValues(opts.everyNth ?? 1), { kind: "text" }),
      ax("spec", "Specs Met", "استاندارد", [opts.spec ?? "AS568"], { filterable: false }),
      ax("material", "Material", "جنس", materials),
      ax("hardness", "Hardness", "سختی", hardness),
      colorAxis(colors),
    ],
    derived: [...oringDerived, tempDerived],
    basePriceCents: 41,
    // O-ring price tracks material cost and size, not size alone.
    priceScale: (s) => {
      const od = typeof s.od === "number" ? s.od : 1;
      const mat = String(s.material);
      const matMul =
        mat === "PTFE" ? 4.2 : mat === "Viton" ? 3.1 : mat === "Silicone" ? 2.2 : mat === "EPDM" ? 1.6 : 1;
      return (0.6 + od * 0.42) * matMul;
    },
    packQty: (s) => {
      const od = typeof s.od === "number" ? s.od : 1;
      return od < 1 ? 100 : od < 3 ? 50 : od < 6 ? 25 : 10;
    },
    cap: opts.cap ?? 2200,
  };
}

const ORING_ABOUT_EN =
  "Find the right size, compare compatible materials, and choose the best cross section shape for your O-ring. Dash numbers follow the AS568 sizing system: the series digit sets the cross section and the remaining digits set the inside diameter.";
const ORING_ABOUT_FA =
  "اندازه مناسب را بیابید، جنس‌های سازگار را مقایسه کنید و بهترین شکل مقطع را برای اورینگ خود انتخاب کنید. شماره‌های داش از سیستم AS568 پیروی می‌کنند: رقم سری، قطر مقطع و ارقام بعدی، قطر داخلی را تعیین می‌کند.";

const ORING_FAMILIES: FamilySeed[] = [
  fam(
    "oil-resistant-buna-n-o-rings",
    "Oil-Resistant Buna-N O-Rings",
    "اورینگ بونا-ان مقاوم در برابر روغن",
    "Resist grease, hydraulic and motor oil, mild chemicals, and water",
    "مقاوم در برابر گریس، روغن هیدرولیک و موتور، مواد شیمیایی ملایم و آب",
    // The flagship family spans the full durometer range and both common
    // colours. Soft/Hard Buna-N remain separate families because those are
    // different compounds, not just a different hardness of this one.
    oringGen(
      ["Buna-N"],
      ["Durometer 50A (Soft)", "Durometer 70A (Medium)", "Durometer 90A (Hard)"],
      ["Black", "Brown"],
      { cap: 2400 },
    ),
    {
      aboutEn: ORING_ABOUT_EN,
      aboutFa: ORING_ABOUT_FA,
      groupEn: "Oil-Resistant O-Rings",
      groupFa: "اورینگ‌های مقاوم در برابر روغن",
      icon: "oring",
    },
  ),
  fam(
    "square-profile-oil-resistant-buna-n-o-rings",
    "Square-Profile Oil-Resistant Buna-N O-Rings",
    "اورینگ مربعی بونا-ان مقاوم در برابر روغن",
    "Flat edges on all sides for more contact area than round-profile O-rings",
    "لبه‌های تخت در همه اضلاع برای سطح تماس بیشتر نسبت به اورینگ گرد",
    {
      ...oringGen(["Buna-N"], ["Durometer 70A (Medium)"], ["Black"], { cap: 400, everyNth: 4 }),
      axes: [
        ax("dash", "Dash No.", "شماره داش", dashValues(4), { kind: "text" }),
        ax("profile", "Cross Section", "شکل مقطع", ["Square"], { filterable: true }),
        ax("material", "Material", "جنس", ["Buna-N"]),
        ax("hardness", "Hardness", "سختی", ["Durometer 70A (Medium)", "Durometer 90A (Hard)"]),
        colorAxis(["Black"]),
      ],
    },
    { groupEn: "Oil-Resistant O-Rings", groupFa: "اورینگ‌های مقاوم در برابر روغن", icon: "oring-square" },
  ),
  fam(
    "oil-resistant-soft-buna-n-o-rings",
    "Oil-Resistant Soft Buna-N O-Rings",
    "اورینگ نرم بونا-ان مقاوم در برابر روغن",
    "Softer than standard Buna-N O-rings for a better seal in low-pressure applications",
    "نرم‌تر از بونا-ان استاندارد برای آب‌بندی بهتر در کاربردهای فشار پایین",
    oringGen(["Soft Buna-N"], ["Durometer 50A (Soft)"], ["Black"], { cap: 500, everyNth: 3 }),
    { groupEn: "Oil-Resistant O-Rings", groupFa: "اورینگ‌های مقاوم در برابر روغن", icon: "oring" },
  ),
  fam(
    "oil-resistant-hard-buna-n-o-rings",
    "Oil-Resistant Hard Buna-N O-Rings",
    "اورینگ سخت بونا-ان مقاوم در برابر روغن",
    "Harder than standard Buna-N O-rings for better durability and wear resistance",
    "سخت‌تر از بونا-ان استاندارد برای دوام و مقاومت سایشی بیشتر",
    oringGen(["Hard Buna-N"], ["Durometer 90A (Hard)"], ["Black"], { cap: 580, everyNth: 3 }),
    { groupEn: "Oil-Resistant O-Rings", groupFa: "اورینگ‌های مقاوم در برابر روغن", icon: "oring" },
  ),
  fam(
    "x-profile-oil-resistant-buna-n-o-rings",
    "X-Profile Oil-Resistant Buna-N O-Rings",
    "اورینگ پروفیل ایکس بونا-ان",
    "Four contact points for a strong seal, often in pistons and rotating shafts",
    "چهار نقطه تماس برای آب‌بندی قوی، مناسب پیستون و شفت‌های دوار",
    {
      ...oringGen(["Buna-N"], ["Durometer 70A (Medium)"], ["Black"], { cap: 280, everyNth: 5 }),
      axes: [
        ax("dash", "Dash No.", "شماره داش", dashValues(5), { kind: "text" }),
        ax("profile", "Cross Section", "شکل مقطع", ["X-Profile"]),
        ax("material", "Material", "جنس", ["Buna-N", "Viton"]),
        ax("hardness", "Hardness", "سختی", ["Durometer 70A (Medium)"]),
        colorAxis(["Black"]),
      ],
    },
    { groupEn: "Oil-Resistant O-Rings", groupFa: "اورینگ‌های مقاوم در برابر روغن", icon: "oring-x" },
  ),
  fam(
    "oil-resistant-extreme-pressure-stainless-steel-o-rings",
    "Oil-Resistant Extreme-Pressure Stainless Steel O-Rings",
    "اورینگ فولادی فشار بالا",
    "Silver-plated 321 stainless steel to handle extreme pressure up to 11,000 psi",
    "فولاد زنگ‌نزن ۳۲۱ با آبکاری نقره برای تحمل فشار تا ۱۱٬۰۰۰ پام",
    {
      axes: [
        ax("dash", "Dash No.", "شماره داش", dashValues(20), { kind: "text" }),
        ax("material", "Material", "جنس", ["Stainless Steel"]),
        ax("pressure", "Max Pressure, psi", "حداکثر فشار (پام)", [11000], { kind: "number", filterable: false }),
        tempAxis(["-100 to 500"]),
      ],
      derived: oringDerived,
      basePriceCents: 4200,
      cap: 12,
      leadDays: 21,
    },
    { groupEn: "Oil-Resistant O-Rings", groupFa: "اورینگ‌های مقاوم در برابر روغن", icon: "oring-metal" },
  ),
  fam(
    "made-to-order-oil-resistant-buna-n-o-rings",
    "Made-to-Order Oil-Resistant Buna-N O-Rings",
    "اورینگ بونا-ان ساخت سفارشی",
    "When you need a Buna-N O-ring that's not an industry standard size, we can make you one",
    "اگر به اورینگی خارج از اندازه‌های استاندارد نیاز دارید، برای شما ساخته می‌شود",
    {
      axes: [
        ax("fracWidth", "Fractional Wd.", "عرض کسری", ["1/16", "3/32", "1/8", "3/16", "1/4", "5/16", "3/8"], { kind: "text" }),
        ax("width", "Wd.", "عرض", [0.07, 0.103, 0.125, 0.139, 0.21, 0.25, 0.275, 0.312, 0.375], { unit: '"', kind: "number" }),
        ax("idRange", "Choose an ID", "انتخاب قطر داخلی", ['2.500" to 50.000"'], { filterable: false }),
        ax("spec", "Specs Met", "استاندارد", ["ASTM D2000"], { filterable: false }),
        ax("material", "Material", "جنس", ["Buna-N"]),
        ax("hardness", "Hardness", "سختی", ["Durometer 70A (Medium)"]),
        tempAxis(["-20 to 250"]),
        colorAxis(["Black"]),
      ],
      basePriceCents: 4167,
      priceScale: () => 1,
      packQty: 10,
      leadDays: 14,
      cap: 21,
    },
    {
      aboutEn: ORING_ABOUT_EN,
      aboutFa: ORING_ABOUT_FA,
      groupEn: "Oil-Resistant O-Rings",
      groupFa: "اورینگ‌های مقاوم در برابر روغن",
      icon: "oring",
    },
  ),
  fam(
    "oil-abrasion-resistant-polyurethane-o-rings",
    "Oil- and Abrasion-Resistant Polyurethane O-Rings",
    "اورینگ پلی‌اورتان مقاوم در برابر سایش",
    "More abrasion resistant than Buna-N O-rings, plus they resist mineral oil and motor oil",
    "مقاومت سایشی بیشتر از بونا-ان، همراه با مقاومت در برابر روغن معدنی و موتور",
    oringGen(["Polyurethane"], ["Durometer 90A (Hard)"], ["Clear", "Blue"], { cap: 350, everyNth: 4 }),
    { groupEn: "Oil-Resistant O-Rings", groupFa: "اورینگ‌های مقاوم در برابر روغن", icon: "oring" },
  ),
  fam(
    "weather-oil-resistant-hnbr-o-rings",
    "Weather- and Oil-Resistant HNBR O-Rings",
    "اورینگ HNBR مقاوم در برابر آب‌وهوا و روغن",
    "Contain extra hydrogen to resist chemicals, weather, and abrasion better than Buna-N",
    "هیدروژن افزوده برای مقاومت بیشتر در برابر مواد شیمیایی، آب‌وهوا و سایش",
    oringGen(["HNBR"], ["Durometer 70A (Medium)"], ["Black"], { cap: 200, everyNth: 6 }),
    { groupEn: "Weather-Resistant O-Rings", groupFa: "اورینگ‌های مقاوم در برابر آب‌وهوا", icon: "oring" },
  ),
  fam(
    "high-temperature-viton-o-rings",
    "High-Temperature Viton® O-Rings",
    "اورینگ وایتون دما بالا",
    "Withstand higher temperatures than Buna-N and resist a wide range of chemicals",
    "تحمل دمای بالاتر از بونا-ان و مقاومت در برابر طیف گسترده‌ای از مواد شیمیایی",
    oringGen(["Viton"], ["Durometer 75A (Medium)", "Durometer 90A (Hard)"], ["Black", "Brown"], { cap: 1200 }),
    { groupEn: "High-Temperature O-Rings", groupFa: "اورینگ‌های دما بالا", icon: "oring" },
  ),
  fam(
    "high-temperature-silicone-o-rings",
    "High-Temperature Silicone O-Rings",
    "اورینگ سیلیکونی دما بالا",
    "Stay flexible from -60° to 400° F, and are FDA compliant for food contact",
    "انعطاف‌پذیر از ۶۰- تا ۴۰۰ درجه فارنهایت و منطبق با FDA برای تماس با مواد غذایی",
    oringGen(["Silicone"], ["Durometer 50A (Soft)", "Durometer 70A (Medium)"], ["Red", "Clear", "White"], { cap: 1500 }),
    { groupEn: "High-Temperature O-Rings", groupFa: "اورینگ‌های دما بالا", icon: "oring" },
  ),
  fam(
    "chemical-resistant-ptfe-o-rings",
    "Chemical-Resistant PTFE O-Rings",
    "اورینگ تفلون مقاوم شیمیایی",
    "Resist nearly all chemicals, including strong acids and solvents",
    "مقاوم در برابر تقریباً همه مواد شیمیایی، از جمله اسیدها و حلال‌های قوی",
    oringGen(["PTFE"], ["Durometer 75A (Medium)", "Durometer 90A (Hard)"], ["White"], { cap: 600, everyNth: 2 }),
    { groupEn: "Chemical-Resistant O-Rings", groupFa: "اورینگ‌های مقاوم شیمیایی", icon: "oring" },
  ),
  fam(
    "water-steam-resistant-epdm-o-rings",
    "Water- and Steam-Resistant EPDM O-Rings",
    "اورینگ EPDM مقاوم در برابر آب و بخار",
    "Handle hot water and steam better than Buna-N; not for use with oil",
    "عملکرد بهتر از بونا-ان در آب داغ و بخار؛ مناسب روغن نیست",
    oringGen(["EPDM"], ["Durometer 70A (Medium)", "Durometer 90A (Hard)"], ["Black"], { cap: 900, everyNth: 2 }),
    { groupEn: "Chemical-Resistant O-Rings", groupFa: "اورینگ‌های مقاوم شیمیایی", icon: "oring" },
  ),
  fam(
    "metric-buna-n-o-rings",
    "Metric Buna-N O-Rings",
    "اورینگ متریک بونا-ان",
    "Metric sizes to ISO 3601 for equipment built to metric standards",
    "اندازه‌های متریک مطابق ISO 3601 برای تجهیزات با استاندارد متریک",
    {
      axes: [
        ax("id", "ID", "قطر داخلی", METRIC_ORING_IDS, { unit: "mm", kind: "number" }),
        ax("width", "Width", "قطر مقطع", METRIC_ORING_WIDTHS, { unit: "mm", kind: "number" }),
        ax("material", "Material", "جنس", ["Buna-N", "Viton", "Silicone", "EPDM"]),
        ax("hardness", "Hardness", "سختی", ["Durometer 70A (Medium)"]),
        tempAxis(["-20 to 250"]),
        colorAxis(["Black"]),
      ],
      derived: [
        {
          key: "od",
          labelEn: "OD",
          labelFa: "قطر خارجی",
          unit: "mm",
          kind: "number" as const,
          filterable: true,
          after: "width",
          compute: (s: Record<string, unknown>) =>
            Number(s.id) + 2 * Number(s.width),
        },
      ],
      basePriceCents: 38,
      priceScale: (s) => 0.7 + Number(s.id ?? 10) * 0.02,
      packQty: 50,
      cap: 1600,
    },
    { groupEn: "Metric O-Rings", groupFa: "اورینگ‌های متریک", icon: "oring" },
  ),
];

// ---------------------------------------------------------------------------
// Generic family builders reused across the breadth of the catalog
// ---------------------------------------------------------------------------

/** Threaded fastener: thread size x length x material x finish. */
function threadedFastenerGen(
  threads: string[],
  lengths: number[],
  materials: string[],
  finishes: string[],
  opts: { unit?: string; base?: number; cap?: number; drive?: string[] } = {},
): FamilyGen {
  const axes = [
    ax("thread", "Thread Size", "اندازه رزوه", threads, { kind: "text" }),
    ax("length", "Length", "طول", lengths, { unit: opts.unit ?? '"', kind: "number" }),
    ...(opts.drive ? [ax("drive", "Drive Style", "نوع درایو", opts.drive)] : []),
    materialAxis(materials),
    finishAxis(finishes),
  ];
  return {
    axes,
    basePriceCents: opts.base ?? 22,
    priceScale: (s) => {
      const len = Number(s.length ?? 1);
      const mat = String(s.material);
      const mul =
        mat === "Titanium" ? 9 : mat === "316 Stainless Steel" ? 2.4 :
        mat === "18-8 Stainless Steel" ? 1.8 : mat === "Brass" ? 2.1 :
        mat === "Nylon" ? 0.7 : 1;
      return (0.5 + len * 0.35) * mul;
    },
    packQty: (s) => (Number(s.length ?? 1) < 1 ? 100 : Number(s.length ?? 1) < 3 ? 50 : 25),
    cap: opts.cap ?? 1800,
  };
}

/**
 * Ring-shaped part: ID x radial wall x thickness x material.
 *
 * OD is *derived* (id + 2 x wall) rather than being its own axis. An
 * independent OD axis would happily produce a washer with a 1" bore in a 0.25"
 * disc — dimensionally impossible parts that make the spec table read as fake.
 */
function ringGen(
  ids: number[],
  walls: number[],
  thicknesses: number[],
  materials: string[],
  opts: { unit?: string; base?: number; cap?: number; finishes?: string[] } = {},
): FamilyGen {
  const unit = opts.unit ?? '"';
  return {
    axes: [
      idAxis(ids, unit),
      ax("wall", "Radial Wall", "ضخامت شعاعی", walls, { unit, kind: "number", filterable: false }),
      thicknessAxis(thicknesses, unit),
      materialAxis(materials),
      ...(opts.finishes ? [finishAxis(opts.finishes)] : []),
    ],
    derived: [
      {
        key: "od",
        labelEn: "OD",
        labelFa: "قطر خارجی",
        unit,
        kind: "number" as const,
        filterable: true,
        after: "wall",
        compute: (s: Record<string, unknown>) =>
          Number((Number(s.id) + 2 * Number(s.wall)).toFixed(3)),
      },
    ],
    basePriceCents: opts.base ?? 30,
    cap: opts.cap ?? 1200,
    packQty: 50,
  };
}

/** Catch-all: a size ladder plus material, for breadth categories. */
function simpleGen(
  sizeKey: string,
  sizeEn: string,
  sizeFa: string,
  sizes: (string | number)[],
  materials: string[],
  opts: {
    unit?: string;
    base?: number;
    cap?: number;
    extraAxes?: ReturnType<typeof ax>[];
    packQty?: number;
  } = {},
): FamilyGen {
  return {
    axes: [
      ax(sizeKey, sizeEn, sizeFa, sizes, {
        unit: opts.unit ?? "",
        kind: typeof sizes[0] === "number" ? "number" : "text",
      }),
      materialAxis(materials),
      ...(opts.extraAxes ?? []),
    ],
    basePriceCents: opts.base ?? 180,
    cap: opts.cap ?? 600,
    packQty: opts.packQty ?? 1,
  };
}

// ---------------------------------------------------------------------------
// The catalog
// ---------------------------------------------------------------------------

export const TAXONOMY: CategorySeed[] = [
  // ========================= SEALING ======================================
  cat("sealing", "Sealing", "آب‌بندی", "oring", {
    children: [
      cat("o-rings-backup-rings-and-more", "O-Rings, Backup Rings, and More", "اورینگ، رینگ پشتیبان و موارد دیگر", "oring", {
        children: [
          cat("o-rings", "O-Rings", "اورینگ", "oring", { families: ORING_FAMILIES }),
          cat("backup-rings", "Backup Rings", "رینگ پشتیبان", "oring", {
            families: [
              fam(
                "ptfe-backup-rings",
                "PTFE Backup Rings",
                "رینگ پشتیبان تفلون",
                "Install behind an O-ring to stop it extruding under high pressure",
                "پشت اورینگ نصب می‌شود تا از بیرون‌زدگی آن در فشار بالا جلوگیری کند",
                oringGen(["PTFE"], ["Durometer 90A (Hard)"], ["White"], { cap: 260, everyNth: 5 }),
                { icon: "oring" },
              ),
              fam(
                "spiral-backup-rings",
                "Spiral Backup Rings",
                "رینگ پشتیبان مارپیچ",
                "Spiral cut so they install without disassembling the shaft",
                "برش مارپیچ برای نصب بدون بازکردن شفت",
                oringGen(["PTFE", "Nylon"], ["Durometer 90A (Hard)"], ["White", "Natural"], { cap: 200, everyNth: 7 }),
                { icon: "oring" },
              ),
            ],
          }),
          cat("o-ring-kits", "O-Ring Kits", "کیت اورینگ", "kit", {
            families: [
              fam(
                "o-ring-assortment-kits",
                "O-Ring Assortment Kits",
                "کیت متنوع اورینگ",
                "A range of the most common sizes in one labelled case",
                "پرکاربردترین اندازه‌ها در یک جعبه برچسب‌خورده",
                simpleGen("pieces", "Pieces", "تعداد قطعه", [180, 225, 382, 407, 419, 1200], ["Buna-N", "Viton", "Silicone", "EPDM"], {
                  base: 4800,
                  cap: 40,
                  extraAxes: [ax("sizeRange", "Size Range", "بازه اندازه", ["-004 to -050", "-102 to -150", "-201 to -284", "Assorted"], { filterable: true })],
                }),
                { icon: "kit" },
              ),
            ],
          }),
        ],
      }),
      cat("gaskets", "Gaskets", "واشر آب‌بندی", "gasket", {
        families: [
          fam(
            "ring-gaskets-for-pipe-flanges",
            "Ring Gaskets for Pipe Flanges",
            "واشر رینگی فلنج لوله",
            "Fit inside the bolt circle of a standard pipe flange",
            "درون دایره پیچ فلنج استاندارد لوله قرار می‌گیرد",
            simpleGen("pipeSize", "Pipe Size", "سایز لوله", PIPE_SIZES, ["Buna-N", "EPDM", "PTFE", "Neoprene", "Graphite"], {
              base: 240,
              cap: 420,
              extraAxes: [
                ax("pressureClass", "Pressure Class", "کلاس فشار", ["150 psi", "300 psi"]),
                thicknessAxis([0.0625, 0.125, 0.1875]),
              ],
            }),
            { icon: "gasket" },
          ),
          fam(
            "gasket-material-sheets",
            "Gasket Material Sheets",
            "ورق واشر",
            "Cut your own gaskets to any shape from a full sheet",
            "واشر با هر شکل دلخواه را از ورق کامل برش دهید",
            simpleGen("sheetSize", "Sheet Size", "ابعاد ورق", ['6" x 6"', '12" x 12"', '12" x 24"', '24" x 24"', '36" x 36"'], ["Buna-N", "Neoprene", "EPDM", "Silicone", "Cork", "Felt", "PTFE"], {
              base: 620,
              cap: 380,
              extraAxes: [thicknessAxis([0.03125, 0.0625, 0.09375, 0.125, 0.1875, 0.25])],
            }),
            { icon: "sheet" },
          ),
        ],
      }),
      cat("shaft-seals", "Shaft Seals", "کاسه‌نمد", "seal", {
        families: [
          fam(
            "oil-resistant-shaft-seals",
            "Oil-Resistant Rotary Shaft Seals",
            "کاسه‌نمد دوار مقاوم در برابر روغن",
            "Spring-loaded lip keeps oil in and contaminants out of rotating shafts",
            "لبه فنردار روغن را نگه می‌دارد و از ورود آلودگی به شفت دوار جلوگیری می‌کند",
            ringGen(
              range(6, 100, 2),
              [5, 6, 7, 8, 10, 12, 15],
              [4, 5, 6, 7, 8, 10, 12],
              ["Buna-N", "Viton", "Silicone"],
              { unit: "mm", base: 240, cap: 900 },
            ),
            { icon: "seal" },
          ),
        ],
      }),
    ],
  }),

  // ==================== FASTENING & JOINING ==============================
  cat("fastening-joining", "Fastening & Joining", "اتصال و بست", "screw", {
    children: [
      cat("screws-bolts", "Screws & Bolts", "پیچ و بولت", "screw", {
        children: [
          cat("socket-head-screws", "Socket Head Screws", "پیچ آلن", "screw", {
            families: [
              fam(
                "socket-head-cap-screws",
                "Socket Head Cap Screws",
                "پیچ آلن سرتخت استوانه‌ای",
                "The most common socket screw; a hex drive gives high torque in tight spaces",
                "رایج‌ترین پیچ آلن؛ درایو شش‌گوش گشتاور بالا در فضای محدود می‌دهد",
                threadedFastenerGen(UNC_THREADS, SCREW_LENGTHS_IN, FASTENER_MATERIALS, ["Plain", "Black Oxide", "Zinc Plated"], { cap: 2400, drive: ["Hex Drive"] }),
                {
                  aboutEn:
                    "Socket head cap screws are specified by thread size, length, and material. Alloy steel gives the highest strength; 18-8 stainless resists corrosion in most environments and 316 stainless handles salt water and chlorides.",
                  aboutFa:
                    "پیچ آلن با اندازه رزوه، طول و جنس مشخص می‌شود. فولاد آلیاژی بیشترین استحکام را دارد؛ زنگ‌نزن ۱۸-۸ در بیشتر محیط‌ها مقاوم به خوردگی است و ۳۱۶ در آب شور و کلراید عملکرد بهتری دارد.",
                  groupEn: "Socket Screws",
                  groupFa: "پیچ‌های آلن",
                  icon: "screw",
                },
              ),
              fam(
                "metric-socket-head-cap-screws",
                "Metric Socket Head Cap Screws",
                "پیچ آلن متریک",
                "Metric threads to DIN 912 for equipment built to metric standards",
                "رزوه متریک مطابق DIN 912 برای تجهیزات با استاندارد متریک",
                threadedFastenerGen(METRIC_THREADS, METRIC_LENGTHS_MM, FASTENER_MATERIALS, ["Plain", "Black Oxide", "Zinc Plated"], { unit: "mm", cap: 2000, drive: ["Hex Drive"] }),
                { groupEn: "Socket Screws", groupFa: "پیچ‌های آلن", icon: "screw" },
              ),
              fam(
                "flat-head-socket-cap-screws",
                "Flat Head Socket Cap Screws",
                "پیچ آلن سرخزینه",
                "Sit flush with the surface in a countersunk hole",
                "هم‌سطح با سطح کار در سوراخ خزینه قرار می‌گیرد",
                threadedFastenerGen(UNC_THREADS.slice(3), SCREW_LENGTHS_IN, FASTENER_MATERIALS.slice(0, 6), ["Plain", "Black Oxide"], { cap: 1200, drive: ["Hex Drive"] }),
                { groupEn: "Socket Screws", groupFa: "پیچ‌های آلن", icon: "screw-flat" },
              ),
              fam(
                "button-head-socket-cap-screws",
                "Button Head Socket Cap Screws",
                "پیچ آلن سرگرد",
                "A low, rounded head for a finished look where clearance is tight",
                "سر گرد و کم‌ارتفاع برای ظاهر تمیز در فضای محدود",
                threadedFastenerGen(UNC_THREADS.slice(3, 16), SCREW_LENGTHS_IN.slice(0, 15), FASTENER_MATERIALS.slice(0, 5), ["Plain", "Black Oxide"], { cap: 900, drive: ["Hex Drive"] }),
                { groupEn: "Socket Screws", groupFa: "پیچ‌های آلن", icon: "screw-button" },
              ),
              fam(
                "set-screws",
                "Set Screws",
                "پیچ خار (بی‌سر)",
                "Headless screws that clamp a collar or pulley onto a shaft",
                "پیچ بدون سر برای مهار بوش یا پولی روی شفت",
                threadedFastenerGen(UNC_THREADS.slice(2, 15), SCREW_LENGTHS_IN.slice(0, 12), ["Alloy Steel", "18-8 Stainless Steel", "Brass"], ["Plain", "Black Oxide"], { cap: 700, drive: ["Hex Drive", "Slotted"] }),
                { groupEn: "Socket Screws", groupFa: "پیچ‌های آلن", icon: "setscrew" },
              ),
            ],
          }),
          cat("hex-head-screws", "Hex Head Screws", "پیچ شش‌گوش", "bolt", {
            families: [
              fam(
                "hex-head-screws-standard",
                "Hex Head Screws",
                "پیچ شش‌گوش",
                "Drive with a wrench or socket; the general-purpose structural fastener",
                "با آچار یا بکس بسته می‌شود؛ بست عمومی سازه‌ای",
                threadedFastenerGen(UNC_THREADS.slice(7), SCREW_LENGTHS_IN.slice(4), ["Zinc-Plated Steel", "18-8 Stainless Steel", "316 Stainless Steel", "Alloy Steel", "Galvanized Steel"], ["Zinc Plated", "Plain", "Hot-Dipped Galvanized"], { cap: 1600, drive: ["External Hex"] }),
                { groupEn: "Hex Screws", groupFa: "پیچ‌های شش‌گوش", icon: "bolt" },
              ),
              fam(
                "grade-8-hex-head-screws",
                "Grade 8 Hex Head Screws",
                "پیچ شش‌گوش گرید ۸",
                "Stronger than Grade 5 for high-load structural connections",
                "مستحکم‌تر از گرید ۵ برای اتصالات سازه‌ای با بار زیاد",
                {
                  ...threadedFastenerGen(UNC_THREADS.slice(8), SCREW_LENGTHS_IN.slice(6), ["Alloy Steel"], ["Zinc Plated", "Black Oxide"], { cap: 500, drive: ["External Hex"] }),
                  axes: [
                    ax("thread", "Thread Size", "اندازه رزوه", UNC_THREADS.slice(8), { kind: "text" }),
                    ax("length", "Length", "طول", SCREW_LENGTHS_IN.slice(6), { unit: '"', kind: "number" }),
                    ax("grade", "Grade", "گرید", ["Grade 8"]),
                    materialAxis(["Alloy Steel"]),
                    finishAxis(["Zinc Plated", "Black Oxide"]),
                  ],
                },
                { groupEn: "Hex Screws", groupFa: "پیچ‌های شش‌گوش", icon: "bolt" },
              ),
            ],
          }),
          cat("machine-screws", "Machine Screws", "پیچ ماشین", "screw", {
            families: [
              fam(
                "phillips-pan-head-machine-screws",
                "Phillips Pan Head Machine Screws",
                "پیچ ماشین سرتخت چهارسو",
                "A rounded head with a wide bearing surface; the everyday machine screw",
                "سر گرد با سطح تکیه‌گاه پهن؛ پیچ ماشین روزمره",
                threadedFastenerGen(UNC_THREADS.slice(0, 12), SCREW_LENGTHS_IN.slice(0, 14), ["18-8 Stainless Steel", "Zinc-Plated Steel", "Brass", "Nylon"], ["Plain", "Zinc Plated"], { cap: 900, drive: ["Phillips"] }),
                { icon: "screw" },
              ),
              fam(
                "torx-flat-head-machine-screws",
                "Torx Flat Head Machine Screws",
                "پیچ ماشین سرخزینه تورکس",
                "Torx drive resists cam-out at high torque",
                "درایو تورکس در گشتاور بالا از لغزش پیچ‌گوشتی جلوگیری می‌کند",
                threadedFastenerGen(UNC_THREADS.slice(3, 14), SCREW_LENGTHS_IN.slice(0, 12), ["18-8 Stainless Steel", "Alloy Steel"], ["Plain", "Black Oxide"], { cap: 500, drive: ["Torx"] }),
                { icon: "screw-flat" },
              ),
            ],
          }),
        ],
      }),
      cat("nuts", "Nuts", "مهره", "nut", {
        families: [
          fam(
            "hex-nuts",
            "Hex Nuts",
            "مهره شش‌گوش",
            "The standard nut for general-purpose fastening",
            "مهره استاندارد برای بست عمومی",
            {
              axes: [
                ax("thread", "Thread Size", "اندازه رزوه", UNC_THREADS, { kind: "text" }),
                materialAxis(FASTENER_MATERIALS),
                finishAxis(["Plain", "Zinc Plated", "Black Oxide", "Hot-Dipped Galvanized"]),
              ],
              derived: [
                {
                  key: "acrossFlats",
                  labelEn: "Width Across Flats",
                  labelFa: "عرض بین دو وجه",
                  unit: '"',
                  kind: "number" as const,
                  filterable: true,
                  // Roughly 1.5x the nominal major diameter, as in the standard.
                  compute: (s: Record<string, unknown>) =>
                    Number((threadNominal(s.thread) * 1.5).toFixed(3)),
                },
              ],
              basePriceCents: 14,
              cap: 640,
              packQty: 100,
            },
            { groupEn: "Hex Nuts", groupFa: "مهره‌های شش‌گوش", icon: "nut" },
          ),
          fam(
            "nylon-insert-locknuts",
            "Nylon-Insert Locknuts",
            "مهره خودقفل نایلونی",
            "A nylon ring grips the thread so vibration cannot back the nut off",
            "حلقه نایلونی رزوه را می‌گیرد تا لرزش مهره را باز نکند",
            {
              axes: [
                ax("thread", "Thread Size", "اندازه رزوه", UNC_THREADS, { kind: "text" }),
                materialAxis(["18-8 Stainless Steel", "316 Stainless Steel", "Zinc-Plated Steel"]),
                finishAxis(["Plain", "Zinc Plated"]),
              ],
              basePriceCents: 26,
              cap: 300,
              packQty: 100,
            },
            { groupEn: "Locknuts", groupFa: "مهره‌های قفل‌شونده", icon: "nut" },
          ),
          fam(
            "metric-hex-nuts",
            "Metric Hex Nuts",
            "مهره شش‌گوش متریک",
            "Metric threads to DIN 934",
            "رزوه متریک مطابق DIN 934",
            {
              axes: [
                ax("thread", "Thread Size", "اندازه رزوه", METRIC_THREADS, { kind: "text" }),
                materialAxis(FASTENER_MATERIALS.slice(0, 6)),
                finishAxis(["Plain", "Zinc Plated", "Black Oxide"]),
              ],
              basePriceCents: 15,
              cap: 400,
              packQty: 100,
            },
            { groupEn: "Hex Nuts", groupFa: "مهره‌های شش‌گوش", icon: "nut" },
          ),
        ],
      }),
      cat("washers", "Washers", "واشر", "washer", {
        families: [
          fam(
            "flat-washers",
            "Flat Washers",
            "واشر تخت",
            "Spread the clamping load over a wider area",
            "بار بست را روی سطح بیشتری پخش می‌کند",
            ringGen(
              [0.094, 0.125, 0.156, 0.188, 0.219, 0.25, 0.312, 0.375, 0.438, 0.5, 0.562, 0.625, 0.75, 0.875, 1],
              [0.078, 0.094, 0.109, 0.141, 0.187, 0.25, 0.312, 0.375],
              [0.02, 0.032, 0.049, 0.065, 0.083, 0.109, 0.134],
              ["18-8 Stainless Steel", "316 Stainless Steel", "Zinc-Plated Steel", "Brass", "Nylon"],
              { base: 9, cap: 1400 },
            ),
            { groupEn: "Flat Washers", groupFa: "واشرهای تخت", icon: "washer" },
          ),
          fam(
            "split-lock-washers",
            "Split Lock Washers",
            "واشر فنری",
            "The split ring bites into the nut and surface to resist loosening",
            "حلقه شکاف‌دار در مهره و سطح فرو می‌رود و از شل‌شدن جلوگیری می‌کند",
            ringGen(
              [0.094, 0.125, 0.156, 0.188, 0.25, 0.312, 0.375, 0.438, 0.5, 0.625, 0.75, 1],
              [0.039, 0.047, 0.055, 0.062, 0.078, 0.094, 0.109, 0.125],
              [0.025, 0.031, 0.04, 0.047, 0.062, 0.078, 0.094, 0.125],
              ["18-8 Stainless Steel", "Zinc-Plated Steel", "Spring Steel"],
              { base: 11, cap: 700 },
            ),
            { groupEn: "Lock Washers", groupFa: "واشرهای قفلی", icon: "washer" },
          ),
        ],
      }),
      cat("rivets", "Rivets", "پرچ", "rivet", {
        families: [
          fam(
            "blind-rivets",
            "Blind Rivets",
            "پرچ کور",
            "Set from one side with a hand or pneumatic rivet tool",
            "از یک طرف با ابزار پرچ دستی یا بادی نصب می‌شود",
            simpleGen("diameter", "Diameter", "قطر", [0.094, 0.125, 0.156, 0.188, 0.25], ["Aluminum", "18-8 Stainless Steel", "Steel", "Copper"], {
              unit: '"',
              base: 12,
              cap: 480,
              packQty: 100,
              extraAxes: [
                ax("grip", "Grip Range", "بازه گیرش", ['0.062"-0.125"', '0.125"-0.250"', '0.250"-0.375"', '0.375"-0.500"', '0.500"-0.750"']),
                ax("headStyle", "Head Style", "نوع سر", ["Round", "Flat"]),
              ],
            }),
            { icon: "rivet" },
          ),
        ],
      }),
      cat("anchors", "Anchors", "رول‌پلاک و انکر", "anchor", {
        families: [
          fam(
            "wedge-anchors",
            "Wedge Anchors",
            "انکر گوه‌ای",
            "Expand against the hole wall for heavy loads in solid concrete",
            "برای بارهای سنگین در بتن توپر، درون سوراخ منبسط می‌شود",
            simpleGen("diameter", "Diameter", "قطر", [0.25, 0.312, 0.375, 0.5, 0.625, 0.75, 1], ["Zinc-Plated Steel", "18-8 Stainless Steel", "316 Stainless Steel", "Hot-Dipped Galvanized" as string], {
              unit: '"',
              base: 95,
              cap: 340,
              packQty: 25,
              extraAxes: [lengthInAxis([1.75, 2.25, 2.75, 3.75, 4.5, 5.5, 7, 8.5])],
            }),
            { icon: "anchor" },
          ),
        ],
      }),
      cat("adhesives-tape", "Adhesives & Tape", "چسب و نوار", "tape", {
        families: [
          fam(
            "threadlockers",
            "Threadlockers",
            "چسب قفل رزوه",
            "Cure in the thread to stop fasteners vibrating loose",
            "درون رزوه سخت می‌شود تا بست بر اثر لرزش باز نشود",
            simpleGen("volume", "Volume", "حجم", ["10 ml", "50 ml", "250 ml"], ["None"], {
              base: 1240,
              cap: 40,
              extraAxes: [
                ax("strength", "Strength", "استحکام", ["Low", "Medium", "High"]),
                ax("color", "Color", "رنگ", ["Purple", "Blue", "Red"]),
              ],
            }),
            { icon: "adhesive" },
          ),
          fam(
            "duct-tape",
            "Duct Tape",
            "نوار چسب برزنتی",
            "Cloth-backed general repair tape",
            "نوار چسب پارچه‌ای برای تعمیرات عمومی",
            simpleGen("width", "Width", "عرض", [1, 1.5, 2, 3, 4], ["None"], {
              unit: '"',
              base: 640,
              cap: 90,
              extraAxes: [
                ax("length", "Length", "طول", [30, 55, 60], { unit: "yd", kind: "number" }),
                colorAxis(["Silver", "Black", "White", "Red", "Yellow"]),
              ],
            }),
            { icon: "tape" },
          ),
        ],
      }),
    ],
  }),

  // ============= PIPE, TUBING, HOSE & FITTINGS ===========================
  cat("pipe-tubing-hose-fittings", "Pipe, Tubing, Hose & Fittings", "لوله، تیوب، شیلنگ و اتصالات", "pipe", {
    children: [
      cat("pipe-fittings-pipe", "Pipe Fittings & Pipe", "اتصالات و لوله", "pipe-fitting", {
        children: [
          cat("threaded-pipe-fittings", "Threaded Pipe Fittings", "اتصالات رزوه‌ای", "pipe-fitting", {
            families: [
              fam(
                "threaded-pipe-elbows",
                "Threaded Pipe Elbows",
                "زانویی رزوه‌ای",
                "Change direction 45° or 90° in a threaded pipe line",
                "تغییر مسیر ۴۵ یا ۹۰ درجه در خط لوله رزوه‌ای",
                simpleGen("pipeSize", "Pipe Size", "سایز لوله", PIPE_SIZES, ["Galvanized Steel", "Carbon Steel", "304 Stainless Steel" as string, "316 Stainless Steel", "Brass", "Cast Iron", "PVC"], {
                  base: 340,
                  cap: 620,
                  extraAxes: [
                    ax("angle", "Angle", "زاویه", ["45°", "90°"]),
                    ax("connection", "Connection", "نوع اتصال", ["Female x Female", "Male x Female"]),
                    ax("pressureClass", "Pressure Class", "کلاس فشار", ["150 psi", "300 psi"]),
                  ],
                }),
                {
                  aboutEn:
                    "Threaded fittings are sized by nominal pipe size (NPS), which is not the physical outside diameter. Pressure class and material determine the working pressure — check both against your line.",
                  aboutFa:
                    "اتصالات رزوه‌ای بر اساس سایز اسمی لوله (NPS) مشخص می‌شوند که با قطر خارجی واقعی برابر نیست. کلاس فشار و جنس، فشار کاری را تعیین می‌کنند — هر دو را با خط خود بررسی کنید.",
                  groupEn: "Threaded Fittings",
                  groupFa: "اتصالات رزوه‌ای",
                  icon: "elbow",
                },
              ),
              fam(
                "threaded-pipe-tees",
                "Threaded Pipe Tees",
                "سه‌راهی رزوه‌ای",
                "Branch a line at 90° without cutting the run",
                "انشعاب ۹۰ درجه بدون قطع مسیر اصلی",
                simpleGen("pipeSize", "Pipe Size", "سایز لوله", PIPE_SIZES, ["Galvanized Steel", "Carbon Steel", "316 Stainless Steel", "Brass", "PVC"], {
                  base: 420,
                  cap: 380,
                  extraAxes: [
                    ax("connection", "Connection", "نوع اتصال", ["Female x Female x Female", "Male x Female x Female"]),
                    ax("pressureClass", "Pressure Class", "کلاس فشار", ["150 psi", "300 psi"]),
                  ],
                }),
                { groupEn: "Threaded Fittings", groupFa: "اتصالات رزوه‌ای", icon: "tee" },
              ),
              fam(
                "threaded-pipe-couplings",
                "Threaded Pipe Couplings",
                "بوشن رزوه‌ای",
                "Join two lengths of threaded pipe in a straight run",
                "اتصال دو قطعه لوله رزوه‌ای در مسیر مستقیم",
                simpleGen("pipeSize", "Pipe Size", "سایز لوله", PIPE_SIZES, ["Galvanized Steel", "Carbon Steel", "316 Stainless Steel", "Brass", "PVC"], {
                  base: 290,
                  cap: 300,
                  extraAxes: [ax("pressureClass", "Pressure Class", "کلاس فشار", ["150 psi", "300 psi"])],
                }),
                { groupEn: "Threaded Fittings", groupFa: "اتصالات رزوه‌ای", icon: "coupling" },
              ),
            ],
          }),
          cat("pipe", "Pipe", "لوله", "pipe", {
            families: [
              fam(
                "threaded-steel-pipe",
                "Threaded Steel Pipe",
                "لوله فولادی رزوه‌شده",
                "Cut to length and threaded on both ends, ready to assemble",
                "بریده‌شده در طول مشخص و رزوه‌شده از دو سر، آماده مونتاژ",
                simpleGen("pipeSize", "Pipe Size", "سایز لوله", PIPE_SIZES, ["Galvanized Steel", "Carbon Steel", "316 Stainless Steel"], {
                  base: 780,
                  cap: 520,
                  extraAxes: [
                    lengthInAxis([6, 12, 18, 24, 36, 48, 60, 72, 120]),
                    ax("schedule", "Schedule", "رده", ["Schedule 40", "Schedule 80", "Schedule 160"]),
                  ],
                }),
                { icon: "pipe" },
              ),
            ],
          }),
        ],
      }),
      cat("tubing", "Tubing", "تیوب", "tube", {
        families: [
          fam(
            "clear-flexible-tubing",
            "Clear Flexible Tubing",
            "تیوب شفاف انعطاف‌پذیر",
            "See flow at a glance; for low-pressure air and water lines",
            "مشاهده جریان با یک نگاه؛ برای خطوط کم‌فشار هوا و آب",
            {
              axes: [
                idAxis([0.062, 0.094, 0.125, 0.187, 0.25, 0.312, 0.375, 0.5, 0.625, 0.75, 1]),
                ax("wall", "Wall Thickness", "ضخامت جداره", [0.031, 0.047, 0.062, 0.094, 0.125], { unit: '"', kind: "number" }),
                materialAxis(["PVC", "Polyurethane", "Silicone", "PTFE", "Polyethylene"]),
                ax("hardness", "Hardness", "سختی", ["Durometer 70A (Medium)", "Durometer 90A (Hard)"]),
                ax("length", "Length", "طول", [5, 10, 25, 50, 100], { unit: "ft", kind: "number" }),
              ],
              derived: [
                {
                  key: "od",
                  labelEn: "OD",
                  labelFa: "قطر خارجی",
                  unit: '"',
                  kind: "number" as const,
                  filterable: true,
                  after: "wall",
                  compute: (s: Record<string, unknown>) =>
                    Number((Number(s.id) + 2 * Number(s.wall)).toFixed(3)),
                },
                tempDerived,
              ],
              basePriceCents: 180,
              priceScale: (s) => 0.6 + Number(s.id ?? 0.5) * 1.6 + Number(s.length ?? 10) * 0.06,
              cap: 1400,
            },
            { icon: "tube" },
          ),
          fam(
            "metal-tubing",
            "Metal Tubing",
            "تیوب فلزی",
            "Seamless tube for instrument and hydraulic lines",
            "تیوب بدون درز برای خطوط ابزار دقیق و هیدرولیک",
            {
              axes: [
                odAxis([0.125, 0.187, 0.25, 0.312, 0.375, 0.5, 0.625, 0.75, 1]),
                ax("wall", "Wall Thickness", "ضخامت جداره", [0.02, 0.028, 0.035, 0.049, 0.065, 0.083], { unit: '"', kind: "number" }),
                materialAxis(["316 Stainless Steel", "18-8 Stainless Steel", "Copper", "Brass", "6061 Aluminum"]),
                ax("construction", "Construction", "نوع ساخت", ["Seamless", "Welded"]),
                ax("length", "Length", "طول", [12, 24, 36, 72], { unit: '"', kind: "number" }),
              ],
              basePriceCents: 620,
              cap: 900,
            },
            { icon: "tube" },
          ),
        ],
      }),
      cat("hose", "Hose", "شیلنگ", "hose", {
        families: [
          fam(
            "hydraulic-hose",
            "Hydraulic Hose",
            "شیلنگ هیدرولیک",
            "Wire-reinforced for high-pressure hydraulic lines",
            "تقویت‌شده با سیم برای خطوط هیدرولیک فشار بالا",
            simpleGen("id", "ID", "قطر داخلی", [0.25, 0.312, 0.375, 0.5, 0.625, 0.75, 1, 1.25], ["Rubber"], {
              unit: '"',
              base: 1450,
              cap: 380,
              extraAxes: [
                ax("pressure", "Max Pressure, psi", "حداکثر فشار (پام)", [2000, 2750, 3000, 4000, 5000], { kind: "number" }),
                ax("length", "Length", "طول", [1, 2, 3, 5, 10, 25], { unit: "ft", kind: "number" }),
                ax("reinforcement", "Reinforcement", "تقویت", ["1-Wire Braid", "2-Wire Braid", "4-Spiral"]),
              ],
            }),
            { icon: "hose" },
          ),
          fam(
            "air-hose",
            "Air Hose",
            "شیلنگ باد",
            "For shop air lines and pneumatic tools",
            "برای خطوط هوای کارگاهی و ابزار بادی",
            simpleGen("id", "ID", "قطر داخلی", [0.25, 0.375, 0.5, 0.75, 1], ["Rubber", "PVC", "Polyurethane"], {
              unit: '"',
              base: 890,
              cap: 240,
              extraAxes: [
                ax("length", "Length", "طول", [10, 25, 50, 100], { unit: "ft", kind: "number" }),
                colorAxis(["Red", "Blue", "Yellow", "Black"]),
              ],
            }),
            { icon: "hose" },
          ),
        ],
      }),
      cat("hose-tube-clamps", "Hose & Tube Clamps", "بست شیلنگ و تیوب", "clamp", {
        families: [
          fam(
            "worm-drive-hose-clamps",
            "Worm-Drive Hose Clamps",
            "بست شیلنگ حلزونی",
            "Tighten with a screwdriver or nut driver; the standard hose clamp",
            "با پیچ‌گوشتی یا آچار بکس سفت می‌شود؛ بست استاندارد شیلنگ",
            simpleGen("clampRange", "Clamp Range", "بازه بست", ['1/4"-5/8"', '1/2"-1 1/4"', '3/4"-1 3/4"', '1"-2"', '1 1/2"-2 1/2"', '2"-3"', '2 1/2"-4"', '3"-5"', '4"-6"'], ["18-8 Stainless Steel", "316 Stainless Steel", "Zinc-Plated Steel"], {
              base: 78,
              cap: 220,
              packQty: 10,
              extraAxes: [ax("bandWidth", "Band Width", "عرض تسمه", [0.312, 0.5, 0.562], { unit: '"', kind: "number" })],
            }),
            { icon: "clamp" },
          ),
        ],
      }),
    ],
  }),

  // ==================== POWER TRANSMISSION ================================
  cat("power-transmission", "Power Transmission", "انتقال قدرت", "gear", {
    children: [
      cat("bearings", "Bearings", "بلبرینگ و یاتاقان", "bearing", {
        families: [
          fam(
            "ball-bearings",
            "Ball Bearings",
            "بلبرینگ ساچمه‌ای",
            "Handle radial loads at high speed; the general-purpose bearing",
            "تحمل بار شعاعی در سرعت بالا؛ بلبرینگ عمومی",
            {
              axes: [
                ax("bore", "Bore", "قطر داخلی", BEARING_BORES, { unit: "mm", kind: "number" }),
                // OD and width are functions of bore and series in every bearing
                // standard, so the series is the axis and the dimensions derive
                // from it. Enumerating OD independently would emit an 80 mm bore
                // inside a 10 mm outer race.
                ax("series", "Series", "سری", ["Light", "Medium", "Heavy"]),
                ax("sealType", "Seal Type", "نوع آب‌بند", ["Open", "Shielded", "Sealed", "Double Sealed", "Double Shielded"]),
                materialAxis(["Steel", "440C Stainless Steel" as string, "Ceramic"]),
              ],
              derived: [
                {
                  key: "od",
                  labelEn: "OD",
                  labelFa: "قطر خارجی",
                  unit: "mm",
                  kind: "number" as const,
                  filterable: true,
                  after: "series",
                  compute: (s: Record<string, unknown>) => {
                    const bore = Number(s.bore ?? 10);
                    const mul =
                      s.series === "Heavy" ? 2.6 : s.series === "Medium" ? 2.15 : 1.8;
                    return Math.round(bore * mul + 6);
                  },
                },
                {
                  key: "width",
                  labelEn: "Width",
                  labelFa: "عرض",
                  unit: "mm",
                  kind: "number" as const,
                  filterable: true,
                  after: "series",
                  compute: (s: Record<string, unknown>) => {
                    const bore = Number(s.bore ?? 10);
                    const mul =
                      s.series === "Heavy" ? 0.72 : s.series === "Medium" ? 0.58 : 0.45;
                    return Math.max(3, Math.round(bore * mul * 0.6 + 2));
                  },
                },
                {
                  key: "maxRpm",
                  labelEn: "Max Speed, rpm",
                  labelFa: "حداکثر سرعت (دور بر دقیقه)",
                  kind: "number" as const,
                  filterable: false,
                  compute: (s: Record<string, unknown>) => {
                    // Speed falls off with bore size; sealed bearings run slower.
                    const bore = Number(s.bore ?? 10);
                    const sealed = String(s.sealType).includes("Sealed");
                    const base = Math.round(500000 / Math.max(bore, 3) / 100) * 100;
                    return sealed ? Math.round(base * 0.6) : base;
                  },
                },
                {
                  key: "dynamicLoad",
                  labelEn: "Dynamic Load Cap., lbs",
                  labelFa: "ظرفیت بار دینامیک (پوند)",
                  kind: "number" as const,
                  filterable: false,
                  compute: (s: Record<string, unknown>) =>
                    Math.round(Number(s.bore ?? 10) * 62 + Number(s.width ?? 5) * 48),
                },
              ],
              basePriceCents: 480,
              priceScale: (s) => {
                const mat = String(s.material);
                const mul = mat === "Ceramic" ? 6.5 : mat.includes("Stainless") ? 2.3 : 1;
                return (0.5 + Number(s.bore ?? 10) * 0.06) * mul;
              },
              cap: 2600,
            },
            {
              aboutEn:
                "Ball bearings are specified by bore, outside diameter, and width — the three dimensions that must match your housing and shaft. Shielded bearings keep out dirt at higher speeds; sealed bearings keep out liquid but run slower.",
              aboutFa:
                "بلبرینگ با قطر داخلی، قطر خارجی و عرض مشخص می‌شود — سه بعدی که باید با نشیمنگاه و شفت شما مطابقت داشته باشد. نوع درپوش‌دار در سرعت بالاتر مانع ورود گردوغبار می‌شود و نوع آب‌بندی‌شده مانع ورود مایعات است اما سرعت کمتری دارد.",
              groupEn: "Rotary Motion",
              groupFa: "حرکت دورانی",
              icon: "bearing",
            },
          ),
          fam(
            "mounted-ball-bearings",
            "Mounted Ball Bearings",
            "یاتاقان بلبرینگ‌دار",
            "Bearing and housing in one unit; bolt straight to a frame",
            "بلبرینگ و نشیمنگاه یکپارچه؛ مستقیم به شاسی پیچ می‌شود",
            simpleGen("bore", "Bore", "قطر داخلی", [0.5, 0.625, 0.75, 0.875, 1, 1.25, 1.5, 1.75, 2], ["Cast Iron", "Steel", "18-8 Stainless Steel"], {
              unit: '"',
              base: 2400,
              cap: 240,
              extraAxes: [ax("mountType", "Mount Type", "نوع نصب", ["Flange", "Pillow Block", "Take-Up"])],
            }),
            { groupEn: "Rotary Motion", groupFa: "حرکت دورانی", icon: "bearing" },
          ),
        ],
      }),
      cat("shafts-collars", "Shafts & Shaft Collars", "شفت و بوش", "shaft", {
        families: [
          fam(
            "precision-shafts",
            "Precision Ground Shafts",
            "شفت سنگ‌خورده دقیق",
            "Ground and polished to a close tolerance for linear bearings",
            "سنگ‌زنی و پولیش با تلورانس نزدیک برای بلبرینگ خطی",
            simpleGen("diameter", "Diameter", "قطر", [0.125, 0.187, 0.25, 0.312, 0.375, 0.5, 0.625, 0.75, 1, 1.25, 1.5], ["Steel", "440C Stainless Steel" as string, "6061 Aluminum"], {
              unit: '"',
              base: 940,
              cap: 420,
              extraAxes: [lengthInAxis([6, 12, 18, 24, 36, 48, 60])],
            }),
            { groupEn: "Rotary Motion", groupFa: "حرکت دورانی", icon: "shaft" },
          ),
          fam(
            "shaft-collars",
            "Shaft Collars",
            "بوش شفت",
            "Clamp onto a shaft to set the position of a bearing or pulley",
            "روی شفت بسته می‌شود تا موقعیت بلبرینگ یا پولی را تثبیت کند",
            simpleGen("bore", "Bore", "قطر داخلی", [0.125, 0.187, 0.25, 0.312, 0.375, 0.5, 0.625, 0.75, 1, 1.25, 1.5, 2], ["Steel", "18-8 Stainless Steel", "6061 Aluminum", "Black-Oxide Steel"], {
              unit: '"',
              base: 420,
              cap: 380,
              extraAxes: [ax("style", "Style", "نوع", ["One-Piece Clamp", "Two-Piece Clamp", "Set Screw"])],
            }),
            { groupEn: "Rotary Motion", groupFa: "حرکت دورانی", icon: "collar" },
          ),
        ],
      }),
      cat("belts-chain", "Belts & Chain", "تسمه و زنجیر", "chain", {
        families: [
          fam(
            "v-belts",
            "V-Belts",
            "تسمه V",
            "Wedge into a pulley groove to transmit power between shafts",
            "درون شیار پولی گوه می‌شود و قدرت را بین شفت‌ها منتقل می‌کند",
            simpleGen("beltSection", "Belt Section", "مقطع تسمه", ["A", "B", "C", "3L", "4L", "5L"], ["Rubber"], {
              base: 780,
              cap: 300,
              extraAxes: [
                ax("outsideLength", "Outside Length", "طول خارجی", range(20, 120, 2), { unit: '"', kind: "number" }),
                ax("topWidth", "Top Width", "عرض بالا", [0.375, 0.5, 0.625, 0.875], { unit: '"', kind: "number" }),
              ],
            }),
            { groupEn: "Belts & Chain", groupFa: "تسمه و زنجیر", icon: "belt" },
          ),
          fam(
            "roller-chain",
            "Roller Chain",
            "زنجیر غلتکی",
            "ANSI standard roller chain for sprocket drives",
            "زنجیر غلتکی استاندارد ANSI برای درایو چرخ‌زنجیر",
            simpleGen("chainSize", "Chain Size", "سایز زنجیر", ["#25", "#35", "#40", "#41", "#50", "#60", "#80", "#100"], ["Steel", "18-8 Stainless Steel", "Nickel Plated" as string], {
              base: 1650,
              cap: 200,
              extraAxes: [
                ax("pitch", "Pitch", "گام", [0.25, 0.375, 0.5, 0.625, 0.75, 1, 1.25], { unit: '"', kind: "number" }),
                ax("length", "Length", "طول", [1, 5, 10, 25], { unit: "ft", kind: "number" }),
              ],
            }),
            { groupEn: "Belts & Chain", groupFa: "تسمه و زنجیر", icon: "chain" },
          ),
        ],
      }),
      cat("gears", "Gears", "چرخ‌دنده", "gear", {
        families: [
          fam(
            "spur-gears",
            "Spur Gears",
            "چرخ‌دنده ساده",
            "Straight teeth transmit motion between parallel shafts",
            "دندانه مستقیم برای انتقال حرکت بین شفت‌های موازی",
            simpleGen("teeth", "Number of Teeth", "تعداد دندانه", [12, 15, 18, 20, 24, 28, 30, 36, 40, 48, 60, 72, 96], ["Steel", "18-8 Stainless Steel", "Acetal", "Nylon 6/6", "Brass", "Cast Iron"], {
              base: 1180,
              cap: 640,
              extraAxes: [
                ax("pitch", "Diametral Pitch", "مدول", [16, 20, 24, 32, 48], { kind: "number" }),
                ax("bore", "Bore", "قطر داخلی", [0.125, 0.187, 0.25, 0.375, 0.5, 0.625], { unit: '"', kind: "number" }),
              ],
            }),
            { groupEn: "Rotary Motion", groupFa: "حرکت دورانی", icon: "gear" },
          ),
        ],
      }),
    ],
  }),

  // ========================= RAW MATERIALS ================================
  cat("raw-materials", "Raw Materials", "مواد اولیه", "bar", {
    children: [
      cat("metal-bars-sheets", "Metal Bars & Sheets", "میلگرد و ورق فلزی", "bar", {
        families: [
          fam(
            "metal-round-bars",
            "Metal Round Bars",
            "میلگرد گرد",
            "Stock for turning, shafts, and pins",
            "مواد اولیه برای تراشکاری، شفت و پین",
            simpleGen("diameter", "Diameter", "قطر", [0.125, 0.187, 0.25, 0.312, 0.375, 0.5, 0.625, 0.75, 0.875, 1, 1.25, 1.5, 2, 2.5, 3], ["6061 Aluminum", "7075 Aluminum", "18-8 Stainless Steel", "316 Stainless Steel", "Low-Carbon Steel", "Brass", "Copper", "Titanium"], {
              unit: '"',
              base: 680,
              cap: 900,
              extraAxes: [lengthInAxis([6, 12, 24, 36, 48, 72])],
            }),
            { groupEn: "Metal", groupFa: "فلز", icon: "bar" },
          ),
          fam(
            "metal-sheets",
            "Metal Sheets & Plates",
            "ورق و پلیت فلزی",
            "Flat stock for brackets, panels, and machined parts",
            "ورق تخت برای براکت، پنل و قطعات ماشین‌کاری‌شده",
            simpleGen("thickness", "Thickness", "ضخامت", [0.016, 0.025, 0.032, 0.04, 0.05, 0.063, 0.08, 0.09, 0.125, 0.19, 0.25, 0.375, 0.5], ["6061 Aluminum", "18-8 Stainless Steel", "316 Stainless Steel", "Low-Carbon Steel", "Brass", "Copper"], {
              unit: '"',
              base: 1450,
              cap: 700,
              extraAxes: [ax("sheetSize", "Size", "ابعاد", ['6" x 6"', '6" x 12"', '12" x 12"', '12" x 24"', '24" x 24"', '24" x 48"', '36" x 36"'])],
            }),
            { groupEn: "Metal", groupFa: "فلز", icon: "sheet" },
          ),
        ],
      }),
      cat("plastic-stock", "Plastic Stock", "مواد پلاستیکی", "sheet", {
        families: [
          fam(
            "plastic-sheets",
            "Plastic Sheets",
            "ورق پلاستیکی",
            "Machinable plastic stock for guards, wear plates, and fixtures",
            "ورق پلاستیکی قابل ماشین‌کاری برای حفاظ، صفحه سایشی و فیکسچر",
            simpleGen("thickness", "Thickness", "ضخامت", [0.031, 0.062, 0.093, 0.125, 0.187, 0.25, 0.375, 0.5, 0.75, 1], PLASTICS, {
              unit: '"',
              base: 980,
              cap: 640,
              extraAxes: [ax("sheetSize", "Size", "ابعاد", ['6" x 12"', '12" x 12"', '12" x 24"', '24" x 24"', '24" x 48"'])],
            }),
            { groupEn: "Plastic", groupFa: "پلاستیک", icon: "sheet" },
          ),
          fam(
            "plastic-rods",
            "Plastic Rods",
            "میلگرد پلاستیکی",
            "Turn bushings, rollers, and spacers from solid plastic rod",
            "ساخت بوش، غلتک و اسپیسر از میلگرد پلاستیکی توپر",
            simpleGen("diameter", "Diameter", "قطر", [0.25, 0.375, 0.5, 0.625, 0.75, 1, 1.25, 1.5, 2, 2.5, 3], PLASTICS, {
              unit: '"',
              base: 720,
              cap: 480,
              extraAxes: [lengthInAxis([6, 12, 24, 36, 48])],
            }),
            { groupEn: "Plastic", groupFa: "پلاستیک", icon: "bar" },
          ),
        ],
      }),
    ],
  }),

  // ======================= FLOW & LEVEL CONTROL ===========================
  cat("flow-level-control", "Flow & Level Control", "کنترل جریان و سطح", "valve", {
    children: [
      cat("valves", "Valves", "شیرآلات", "valve", {
        families: [
          fam(
            "ball-valves",
            "Ball Valves",
            "شیر توپی",
            "Quarter-turn handle gives fast, full-bore shutoff",
            "دسته یک‌چهارم دور، قطع سریع و تمام‌قطر را فراهم می‌کند",
            simpleGen("pipeSize", "Pipe Size", "سایز لوله", PIPE_SIZES.slice(0, 12), ["Brass", "316 Stainless Steel", "PVC", "Carbon Steel", "Bronze"], {
              base: 1380,
              cap: 380,
              extraAxes: [
                ax("connection", "Connection", "نوع اتصال", ["Female x Female", "Male x Female", "Flanged"]),
                ax("pressure", "Max Pressure, psi", "حداکثر فشار (پام)", [150, 300, 600, 1000], { kind: "number" }),
                ax("handleType", "Handle", "دسته", ["Lever", "Tee", "Locking Lever"]),
              ],
            }),
            { groupEn: "Shutoff Valves", groupFa: "شیرهای قطع‌کننده", icon: "valve" },
          ),
          fam(
            "gate-valves",
            "Gate Valves",
            "شیر کشویی",
            "Full-bore shutoff with minimal pressure drop when open",
            "قطع تمام‌قطر با کمترین افت فشار در حالت باز",
            simpleGen("pipeSize", "Pipe Size", "سایز لوله", PIPE_SIZES.slice(2, 13), ["Bronze", "Cast Iron", "316 Stainless Steel"], {
              base: 2450,
              cap: 200,
              extraAxes: [ax("pressureClass", "Pressure Class", "کلاس فشار", ["150 psi", "300 psi"])],
            }),
            { groupEn: "Shutoff Valves", groupFa: "شیرهای قطع‌کننده", icon: "valve" },
          ),
          fam(
            "check-valves",
            "Check Valves",
            "شیر یک‌طرفه",
            "Allow flow one way and close automatically against backflow",
            "اجازه جریان در یک جهت و بستن خودکار در برابر برگشت",
            simpleGen("pipeSize", "Pipe Size", "سایز لوله", PIPE_SIZES.slice(0, 11), ["Brass", "316 Stainless Steel", "PVC", "Bronze"], {
              base: 1620,
              cap: 240,
              extraAxes: [ax("style", "Style", "نوع", ["Swing", "Spring", "Ball"])],
            }),
            { groupEn: "Directional Valves", groupFa: "شیرهای جهت‌دار", icon: "valve" },
          ),
        ],
      }),
      cat("pumps", "Pumps", "پمپ", "pump", {
        families: [
          fam(
            "centrifugal-pumps",
            "Centrifugal Pumps",
            "پمپ گریز از مرکز",
            "High flow at moderate pressure for water and thin liquids",
            "دبی بالا در فشار متوسط برای آب و مایعات رقیق",
            simpleGen("flowRate", "Max Flow, gpm", "حداکثر دبی (گالن بر دقیقه)", [5, 10, 20, 35, 50, 75, 100, 150, 200], ["Cast Iron", "316 Stainless Steel", "Bronze", "Polypropylene"], {
              base: 24800,
              cap: 140,
              extraAxes: [
                ax("motorHp", "Motor", "موتور", [0.33, 0.5, 0.75, 1, 1.5, 2, 3, 5], { unit: "hp", kind: "number" }),
                ax("inletSize", "Inlet Size", "سایز ورودی", ['1"', '1 1/4"', '1 1/2"', '2"', '3"']),
              ],
            }),
            { icon: "pump" },
          ),
        ],
      }),
    ],
  }),

  // ======================== HAND TOOLS ====================================
  cat("hand-tools", "Hand Tools", "ابزار دستی", "wrench", {
    children: [
      cat("wrenches", "Wrenches", "آچار", "wrench", {
        families: [
          fam(
            "combination-wrenches",
            "Combination Wrenches",
            "آچار یک‌سر رینگ یک‌سر تخت",
            "Open end on one side, box end on the other",
            "یک سر تخت و سر دیگر رینگی",
            simpleGen("size", "Size", "سایز", ['1/4"', '5/16"', '3/8"', '7/16"', '1/2"', '9/16"', '5/8"', '11/16"', '3/4"', '13/16"', '7/8"', '15/16"', '1"', "6 mm", "8 mm", "10 mm", "12 mm", "13 mm", "14 mm", "17 mm", "19 mm", "22 mm", "24 mm"], ["Alloy Steel", "Chrome Plated" as string], {
              base: 780,
              cap: 120,
              extraAxes: [ax("system", "System", "سیستم", ["Inch", "Metric"])],
            }),
            { groupEn: "Wrenches", groupFa: "آچارها", icon: "wrench" },
          ),
          fam(
            "hex-key-sets",
            "Hex Key Sets",
            "ست آچار آلن",
            "L-shaped keys for socket screws, in a holder",
            "آچار L شکل برای پیچ آلن، همراه با نگهدارنده",
            simpleGen("pieces", "Pieces", "تعداد قطعه", [9, 10, 13, 22, 26], ["Alloy Steel", "Black-Oxide Steel"], {
              base: 1450,
              cap: 40,
              extraAxes: [ax("system", "System", "سیستم", ["Inch", "Metric"]), ax("tipType", "Tip", "نوک", ["Straight", "Ball End"])],
            }),
            { groupEn: "Wrenches", groupFa: "آچارها", icon: "hexkey" },
          ),
        ],
      }),
      cat("pliers", "Pliers", "انبردست", "pliers", {
        families: [
          fam(
            "needle-nose-pliers",
            "Needle-Nose Pliers",
            "دم‌باریک",
            "Long tapered jaws reach into confined spaces",
            "فک باریک و بلند برای دسترسی به فضاهای محدود",
            simpleGen("length", "Overall Length", "طول کلی", [4.5, 5, 6, 7, 8, 9, 11], ["Alloy Steel"], {
              unit: '"',
              base: 1180,
              cap: 40,
              extraAxes: [ax("jawType", "Jaw", "فک", ["Straight", "Bent 45°", "Bent 90°"])],
            }),
            { icon: "pliers" },
          ),
        ],
      }),
      cat("screwdrivers", "Screwdrivers", "پیچ‌گوشتی", "screwdriver", {
        families: [
          fam(
            "screwdrivers-standard",
            "Screwdrivers",
            "پیچ‌گوشتی",
            "Insulated handle, hardened tip",
            "دسته عایق، نوک سخت‌کاری‌شده",
            simpleGen("tipSize", "Tip Size", "سایز نوک", ["#0", "#1", "#2", "#3", '1/8"', '3/16"', '1/4"', '5/16"'], ["Alloy Steel"], {
              base: 620,
              cap: 90,
              extraAxes: [
                ax("drive", "Drive", "نوع", ["Phillips", "Slotted", "Torx"]),
                ax("shankLength", "Shank Length", "طول شفت", [3, 4, 6, 8, 10], { unit: '"', kind: "number" }),
              ],
            }),
            { icon: "screwdriver" },
          ),
        ],
      }),
    ],
  }),

  // ==================== MEASURING & INSPECTING ============================
  cat("measuring-inspecting", "Measuring & Inspecting", "اندازه‌گیری و بازرسی", "caliper", {
    children: [
      cat("dimensional-measuring", "Dimensional Measuring", "اندازه‌گیری ابعادی", "caliper", {
        families: [
          fam(
            "calipers",
            "Calipers",
            "کولیس",
            "Measure inside, outside, and depth with one tool",
            "اندازه‌گیری داخلی، خارجی و عمق با یک ابزار",
            simpleGen("range", "Range", "بازه اندازه‌گیری", ['0-6"', '0-8"', '0-12"', "0-150 mm", "0-200 mm", "0-300 mm"], ["18-8 Stainless Steel", "Carbon Steel"], {
              base: 4200,
              cap: 60,
              extraAxes: [
                ax("readout", "Readout", "نمایشگر", ["Digital", "Dial", "Vernier"]),
                ax("accuracy", "Accuracy", "دقت", ['±0.001"', '±0.0015"', "±0.02 mm"]),
              ],
            }),
            { groupEn: "Dimensional", groupFa: "ابعادی", icon: "caliper" },
          ),
          fam(
            "micrometers",
            "Micrometers",
            "میکرومتر",
            "Higher precision than a caliper for outside dimensions",
            "دقت بالاتر از کولیس برای ابعاد خارجی",
            simpleGen("range", "Range", "بازه اندازه‌گیری", ['0-1"', '1-2"', '2-3"', '3-4"', "0-25 mm", "25-50 mm"], ["Carbon Steel", "18-8 Stainless Steel"], {
              base: 6800,
              cap: 40,
              extraAxes: [ax("readout", "Readout", "نمایشگر", ["Digital", "Mechanical"])],
            }),
            { groupEn: "Dimensional", groupFa: "ابعادی", icon: "micrometer" },
          ),
        ],
      }),
      cat("pressure-gauges", "Pressure Gauges", "مانومتر", "gauge", {
        families: [
          fam(
            "pressure-gauges-standard",
            "Pressure Gauges",
            "گیج فشار",
            "Bourdon-tube dial gauges for air, water, and hydraulic lines",
            "گیج عقربه‌ای لوله بردون برای خطوط هوا، آب و هیدرولیک",
            simpleGen("range", "Pressure Range, psi", "بازه فشار (پام)", ["0-15", "0-30", "0-60", "0-100", "0-160", "0-300", "0-600", "0-1000", "0-3000", "0-5000"], ["316 Stainless Steel", "Brass", "Carbon Steel"], {
              base: 2280,
              cap: 200,
              extraAxes: [
                ax("dialSize", "Dial Size", "قطر صفحه", [1.5, 2, 2.5, 4], { unit: '"', kind: "number" }),
                ax("connection", "Connection", "محل اتصال", ["Bottom", "Back"]),
              ],
            }),
            { icon: "gauge" },
          ),
        ],
      }),
    ],
  }),

  // ======================= SAFETY SUPPLIES ================================
  cat("safety-supplies", "Safety Supplies", "تجهیزات ایمنی", "safety", {
    children: [
      cat("eye-protection", "Eye Protection", "حفاظت چشم", "goggles", {
        families: [
          fam(
            "safety-glasses",
            "Safety Glasses",
            "عینک ایمنی",
            "Impact-rated lenses for general shop use",
            "لنز مقاوم در برابر ضربه برای کاربرد عمومی کارگاهی",
            simpleGen("lensColor", "Lens Color", "رنگ لنز", ["Clear", "Gray", "Amber", "Blue"], ["Polycarbonate"], {
              base: 480,
              cap: 60,
              packQty: 12,
              extraAxes: [
                ax("coating", "Coating", "پوشش", ["Anti-Fog", "Scratch-Resistant", "Anti-Fog and Scratch-Resistant"]),
                ax("frameStyle", "Frame", "فریم", ["Wraparound", "Standard", "Over-Glasses"]),
              ],
            }),
            { icon: "goggles" },
          ),
        ],
      }),
      cat("hand-protection", "Hand Protection", "حفاظت دست", "glove", {
        families: [
          fam(
            "cut-resistant-gloves",
            "Cut-Resistant Gloves",
            "دستکش ضد برش",
            "Rated to ANSI cut levels for handling sheet metal and glass",
            "دارای سطح مقاومت برش ANSI برای کار با ورق فلزی و شیشه",
            simpleGen("size", "Size", "سایز", ["XS", "S", "M", "L", "XL", "2XL"], ["Nylon", "Fiberglass", "Leather"], {
              base: 620,
              cap: 80,
              packQty: 12,
              extraAxes: [
                ax("cutLevel", "ANSI Cut Level", "سطح برش ANSI", ["A2", "A3", "A4", "A5", "A6"]),
                ax("coating", "Coating", "پوشش", ["Polyurethane", "Nitrile", "None"]),
              ],
            }),
            { icon: "glove" },
          ),
        ],
      }),
      cat("respiratory-protection", "Respiratory Protection", "حفاظت تنفسی", "mask", {
        families: [
          fam(
            "disposable-respirators",
            "Disposable Respirators",
            "ماسک تنفسی یک‌بارمصرف",
            "Filter airborne particulates in dusty environments",
            "فیلتر ذرات معلق در محیط‌های گردوغباری",
            simpleGen("rating", "Filter Rating", "رده فیلتر", ["N95", "N99", "P100", "R95"], ["Polypropylene"], {
              base: 340,
              cap: 30,
              packQty: 20,
              extraAxes: [ax("valve", "Exhalation Valve", "سوپاپ بازدم", ["Yes", "No"])],
            }),
            { icon: "mask" },
          ),
        ],
      }),
    ],
  }),

  // ====================== ELECTRICAL & LIGHTING ===========================
  cat("electrical-lighting", "Electrical & Lighting", "برق و روشنایی", "electrical", {
    children: [
      cat("wire-cable", "Wire & Cable", "سیم و کابل", "wire", {
        families: [
          fam(
            "hookup-wire",
            "Hookup Wire",
            "سیم رابط",
            "Stranded copper wire for panel and control wiring",
            "سیم مسی افشان برای سیم‌کشی تابلو و کنترل",
            simpleGen("gauge", "Wire Gauge", "سایز سیم (AWG)", [24, 22, 20, 18, 16, 14, 12, 10, 8, 6, 4, 2], ["Copper"], {
              base: 890,
              cap: 340,
              extraAxes: [
                colorAxis(["Black", "Red", "White", "Green", "Blue", "Yellow", "Brown"]),
                ax("length", "Length", "طول", [25, 50, 100, 500], { unit: "ft", kind: "number" }),
                ax("insulation", "Insulation", "عایق", ["PVC", "PTFE", "Silicone"]),
              ],
            }),
            { icon: "wire" },
          ),
        ],
      }),
      cat("lighting", "Lighting", "روشنایی", "light", {
        families: [
          fam(
            "led-work-lights",
            "LED Work Lights",
            "چراغ کار LED",
            "High-output fixtures for benches and machine enclosures",
            "چراغ پرنور برای میز کار و محفظه ماشین‌آلات",
            simpleGen("lumens", "Light Output, lm", "شار نوری (لومن)", [800, 1200, 1800, 2400, 3600, 5000, 8000], ["6061 Aluminum", "Polycarbonate"], {
              base: 3400,
              cap: 90,
              extraAxes: [
                ax("colorTemp", "Color Temperature", "دمای رنگ", ["3000 K", "4000 K", "5000 K", "6500 K"]),
                ax("voltage", "Voltage", "ولتاژ", ["12V DC", "24V DC", "120V AC", "220V AC"]),
              ],
            }),
            { icon: "light" },
          ),
        ],
      }),
      cat("enclosures", "Electrical Enclosures", "تابلو برق", "enclosure", {
        families: [
          fam(
            "junction-boxes",
            "Junction Boxes",
            "جعبه تقسیم",
            "Protect terminations from dust and water",
            "محافظت اتصالات در برابر گردوغبار و آب",
            simpleGen("size", "Size", "ابعاد", ['4" x 4" x 2"', '6" x 4" x 3"', '6" x 6" x 4"', '8" x 6" x 4"', '10" x 8" x 4"', '12" x 10" x 6"', '16" x 12" x 6"'], ["Carbon Steel", "18-8 Stainless Steel", "Polycarbonate", "6061 Aluminum"], {
              base: 2180,
              cap: 140,
              extraAxes: [ax("rating", "NEMA Rating", "رده NEMA", ["NEMA 1", "NEMA 3R", "NEMA 4", "NEMA 4X", "NEMA 12"])],
            }),
            { icon: "enclosure" },
          ),
        ],
      }),
    ],
  }),

  // ===================== PRESSURE & TEMPERATURE ===========================
  cat("pressure-temperature-control", "Pressure & Temperature Control", "کنترل فشار و دما", "gauge", {
    children: [
      cat("pressure-regulators", "Pressure Regulators", "رگولاتور فشار", "regulator", {
        families: [
          fam(
            "air-pressure-regulators",
            "Air Pressure Regulators",
            "رگولاتور فشار هوا",
            "Hold a steady downstream pressure regardless of supply swings",
            "فشار پایین‌دست را مستقل از نوسان تغذیه ثابت نگه می‌دارد",
            simpleGen("pipeSize", "Pipe Size", "سایز لوله", PIPE_SIZES.slice(0, 9), ["6061 Aluminum", "Brass", "316 Stainless Steel"], {
              base: 3850,
              cap: 160,
              extraAxes: [
                ax("outletRange", "Outlet Range, psi", "بازه خروجی (پام)", ["0-30", "0-60", "0-125", "0-250"]),
                ax("gauge", "Gauge Included", "همراه با گیج", ["Yes", "No"]),
              ],
            }),
            { icon: "regulator" },
          ),
        ],
      }),
      cat("temperature-control", "Temperature Control", "کنترل دما", "thermometer", {
        families: [
          fam(
            "bimetal-thermometers",
            "Bimetal Thermometers",
            "ترمومتر بی‌متال",
            "Dial thermometers for tanks and pipe lines",
            "ترمومتر عقربه‌ای برای مخازن و خطوط لوله",
            simpleGen("range", "Temp. Range, °F", "بازه دما (°F)", ["0 to 250", "50 to 400", "0 to 500", "-40 to 160", "200 to 1000"], ["316 Stainless Steel"], {
              base: 2650,
              cap: 90,
              extraAxes: [
                ax("stemLength", "Stem Length", "طول ساقه", [2.5, 4, 6, 9, 12], { unit: '"', kind: "number" }),
                ax("dialSize", "Dial Size", "قطر صفحه", [2, 3, 5], { unit: '"', kind: "number" }),
              ],
            }),
            { icon: "thermometer" },
          ),
        ],
      }),
    ],
  }),

  // ======================= MATERIAL HANDLING ==============================
  cat("material-handling", "Material Handling", "جابه‌جایی مواد", "cart", {
    children: [
      cat("casters-wheels", "Casters & Wheels", "چرخ و غلتک", "caster", {
        families: [
          fam(
            "swivel-casters",
            "Swivel Casters",
            "چرخ گردان",
            "Rotate 360° for carts that need to turn in place",
            "چرخش ۳۶۰ درجه برای گاری‌هایی که باید در جا بچرخند",
            simpleGen("wheelDiameter", "Wheel Diameter", "قطر چرخ", [2, 2.5, 3, 4, 5, 6, 8], ["Polyurethane", "Rubber", "Nylon", "Cast Iron", "UHMW"], {
              unit: '"',
              base: 1280,
              cap: 260,
              extraAxes: [
                ax("capacity", "Load Capacity, lbs", "ظرفیت بار (پوند)", [125, 175, 250, 350, 500, 800, 1200], { kind: "number" }),
                ax("brake", "Brake", "ترمز", ["Yes", "No"]),
              ],
            }),
            { icon: "caster" },
          ),
        ],
      }),
      cat("carts-trucks", "Carts & Hand Trucks", "گاری و چرخ دستی", "cart", {
        families: [
          fam(
            "shelf-carts",
            "Shelf Carts",
            "گاری قفسه‌دار",
            "Multi-shelf carts for moving parts between workstations",
            "گاری چندطبقه برای جابه‌جایی قطعات بین ایستگاه‌های کاری",
            simpleGen("capacity", "Load Capacity, lbs", "ظرفیت بار (پوند)", [300, 500, 800, 1200, 2000], ["Carbon Steel", "18-8 Stainless Steel", "6061 Aluminum", "Polypropylene"], {
              base: 18400,
              cap: 70,
              extraAxes: [
                ax("shelves", "Shelves", "تعداد طبقه", [2, 3, 4, 5], { kind: "number" }),
                ax("deckSize", "Deck Size", "ابعاد صفحه", ['18" x 30"', '24" x 36"', '30" x 60"']),
              ],
            }),
            { icon: "cart" },
          ),
        ],
      }),
    ],
  }),

  // ======================== PULLING & LIFTING =============================
  cat("pulling-lifting", "Pulling & Lifting", "کشش و بالابری", "hoist", {
    children: [
      cat("hoists", "Hoists", "جرثقیل و بالابر", "hoist", {
        families: [
          fam(
            "chain-hoists",
            "Chain Hoists",
            "جرثقیل زنجیری",
            "Manual chain hoists for lifting in shops without power",
            "جرثقیل زنجیری دستی برای بالابری در کارگاه بدون برق",
            simpleGen("capacity", "Capacity, tons", "ظرفیت (تن)", [0.25, 0.5, 1, 1.5, 2, 3, 5, 10], ["Alloy Steel"], {
              base: 32800,
              cap: 60,
              extraAxes: [ax("liftHeight", "Lift Height", "ارتفاع بالابری", [8, 10, 15, 20, 30], { unit: "ft", kind: "number" })],
            }),
            { icon: "hoist" },
          ),
        ],
      }),
      cat("slings-rigging", "Slings & Rigging", "بالابر و تجهیزات مهار", "sling", {
        families: [
          fam(
            "wire-rope-slings",
            "Wire Rope Slings",
            "اسلینگ سیم‌بکسل",
            "Eye-and-eye slings for overhead lifting",
            "اسلینگ دوسر چشمی برای بالابری سقفی",
            simpleGen("diameter", "Rope Diameter", "قطر طناب", [0.25, 0.312, 0.375, 0.5, 0.625, 0.75, 1], ["Steel", "18-8 Stainless Steel"], {
              unit: '"',
              base: 2450,
              cap: 180,
              extraAxes: [
                ax("length", "Length", "طول", [2, 3, 4, 6, 8, 10, 12, 20], { unit: "ft", kind: "number" }),
                ax("capacity", "Vertical Capacity, lbs", "ظرفیت عمودی (پوند)", [1400, 2200, 3200, 5600, 8800, 12000, 21000], { kind: "number" }),
              ],
            }),
            { icon: "sling" },
          ),
        ],
      }),
    ],
  }),

  // ========================= SAWING & CUTTING =============================
  cat("sawing-cutting", "Sawing & Cutting", "اره و برش", "saw", {
    children: [
      cat("saw-blades", "Saw Blades", "تیغه اره", "saw", {
        families: [
          fam(
            "band-saw-blades",
            "Band Saw Blades",
            "تیغه اره نواری",
            "Welded loops sized to your machine",
            "حلقه‌های جوش‌خورده متناسب با ماشین شما",
            simpleGen("length", "Blade Length", "طول تیغه", [56.125, 64.5, 72, 80, 93, 105, 131, 158], ["Carbon Steel", "Tool Steel"], {
              unit: '"',
              base: 1680,
              cap: 240,
              extraAxes: [
                widthAxis([0.25, 0.375, 0.5, 0.625, 0.75, 1]),
                ax("tpi", "Teeth per Inch", "دندانه در اینچ", [6, 8, 10, 14, 18, 24], { kind: "number" }),
              ],
            }),
            { icon: "saw" },
          ),
        ],
      }),
      cat("drill-bits", "Drill Bits", "مته", "drill", {
        families: [
          fam(
            "jobber-drill-bits",
            "Jobber-Length Drill Bits",
            "مته استاندارد",
            "General-purpose bits for metal, wood, and plastic",
            "مته عمومی برای فلز، چوب و پلاستیک",
            simpleGen("diameter", "Diameter", "قطر", [0.0625, 0.0781, 0.0938, 0.125, 0.1563, 0.1875, 0.25, 0.3125, 0.375, 0.4375, 0.5, 0.5625, 0.625, 0.75], ["Tool Steel", "Carbon Steel"], {
              unit: '"',
              base: 240,
              cap: 320,
              packQty: 12,
              extraAxes: [
                ax("coating", "Coating", "پوشش", ["Uncoated", "Black Oxide", "Titanium Nitride", "Cobalt"]),
                ax("pointAngle", "Point Angle", "زاویه نوک", ["118°", "135°"]),
              ],
            }),
            { icon: "drill" },
          ),
        ],
      }),
    ],
  }),

  // ==================== ABRADING & POLISHING ==============================
  cat("abrading-polishing", "Abrading & Polishing", "سایش و پرداخت", "abrasive", {
    children: [
      cat("sanding", "Sanding", "سنباده‌زنی", "abrasive", {
        families: [
          fam(
            "sanding-discs",
            "Sanding Discs",
            "دیسک سنباده",
            "Hook-and-loop discs for random orbital sanders",
            "دیسک چسبی برای سنباده‌زن مداری",
            simpleGen("diameter", "Diameter", "قطر", [3, 5, 6, 8], ["Aluminum Oxide" as string, "Silicon Carbide" as string, "Ceramic"], {
              unit: '"',
              base: 320,
              cap: 200,
              packQty: 50,
              extraAxes: [
                ax("grit", "Grit", "زبری", [40, 60, 80, 100, 120, 150, 180, 220, 320, 400], { kind: "number" }),
                ax("backing", "Backing", "پشت‌بند", ["Hook and Loop", "Adhesive"]),
              ],
            }),
            { icon: "abrasive" },
          ),
        ],
      }),
      cat("grinding", "Grinding", "سنگ‌زنی", "grinder", {
        families: [
          fam(
            "grinding-wheels",
            "Grinding Wheels",
            "سنگ فرز",
            "Bonded abrasive wheels for bench and angle grinders",
            "سنگ ساینده برای سنگ رومیزی و فرز",
            simpleGen("diameter", "Diameter", "قطر", [4, 4.5, 5, 6, 7, 8, 9], ["Aluminum Oxide" as string, "Silicon Carbide" as string, "Ceramic"], {
              unit: '"',
              base: 480,
              cap: 180,
              packQty: 10,
              extraAxes: [
                thicknessAxis([0.045, 0.0625, 0.125, 0.25]),
                ax("arborHole", "Arbor Hole", "قطر سوراخ", [0.625, 0.875, 1], { unit: '"', kind: "number" }),
              ],
            }),
            { icon: "grinder" },
          ),
        ],
      }),
    ],
  }),

  // ========================== FILTERING ===================================
  cat("filtering", "Filtering", "فیلتراسیون", "filter", {
    children: [
      cat("liquid-filters", "Liquid Filters", "فیلتر مایعات", "filter", {
        families: [
          fam(
            "inline-liquid-filters",
            "Inline Liquid Filters",
            "فیلتر خطی مایعات",
            "Remove particulate from water, oil, and coolant lines",
            "حذف ذرات از خطوط آب، روغن و مایع خنک‌کننده",
            simpleGen("pipeSize", "Pipe Size", "سایز لوله", PIPE_SIZES.slice(0, 10), ["316 Stainless Steel", "Brass", "Polypropylene", "Nylon"], {
              base: 2450,
              cap: 220,
              extraAxes: [
                ax("micron", "Filtration, microns", "فیلتراسیون (میکرون)", [1, 5, 10, 25, 50, 100, 250], { kind: "number" }),
                ax("maxFlow", "Max Flow, gpm", "حداکثر دبی", [2, 5, 10, 20, 40], { kind: "number" }),
              ],
            }),
            { icon: "filter" },
          ),
        ],
      }),
      cat("air-filters", "Air Filters", "فیلتر هوا", "filter", {
        families: [
          fam(
            "compressed-air-filters",
            "Compressed Air Filters",
            "فیلتر هوای فشرده",
            "Trap water and oil aerosol before pneumatic tools",
            "جداسازی آب و ذرات روغن پیش از ابزار بادی",
            simpleGen("pipeSize", "Pipe Size", "سایز لوله", PIPE_SIZES.slice(0, 8), ["6061 Aluminum", "Polycarbonate", "Brass"], {
              base: 3280,
              cap: 140,
              extraAxes: [
                ax("micron", "Filtration, microns", "فیلتراسیون (میکرون)", [0.01, 0.3, 5, 25, 40], { kind: "number" }),
                ax("drain", "Drain", "تخلیه", ["Manual", "Automatic"]),
              ],
            }),
            { icon: "filter" },
          ),
        ],
      }),
    ],
  }),

  // ========================= LUBRICATING ==================================
  cat("lubricating", "Lubricating", "روان‌کاری", "oiler", {
    children: [
      cat("lubricants", "Lubricants", "روان‌کننده‌ها", "oiler", {
        families: [
          fam(
            "machine-oil",
            "Machine Oil",
            "روغن ماشین‌آلات",
            "General-purpose oil for spindles, ways, and light gearing",
            "روغن عمومی برای اسپیندل، ریل و چرخ‌دنده سبک",
            simpleGen("volume", "Volume", "حجم", ["4 oz", "16 oz", "1 gal", "5 gal"], ["None"], {
              base: 980,
              cap: 60,
              extraAxes: [ax("viscosity", "ISO Viscosity Grade", "گرید ویسکوزیته ISO", ["ISO 10", "ISO 22", "ISO 32", "ISO 46", "ISO 68", "ISO 100"])],
            }),
            { icon: "oiler" },
          ),
          fam(
            "grease",
            "Grease",
            "گریس",
            "Lithium and synthetic greases for bearings and slides",
            "گریس لیتیومی و سنتتیک برای بلبرینگ و ریل",
            simpleGen("volume", "Volume", "حجم", ["3 oz", "14 oz", "35 lb", "120 lb"], ["None"], {
              base: 840,
              cap: 60,
              extraAxes: [
                ax("thickener", "Thickener", "غلیظ‌کننده", ["Lithium", "Lithium Complex", "Polyurea", "Calcium Sulfonate"]),
                ax("nlgi", "NLGI Grade", "گرید NLGI", ["0", "1", "2", "3"]),
              ],
            }),
            { icon: "grease" },
          ),
        ],
      }),
    ],
  }),

  // ========================= HARDWARE =====================================
  cat("hardware", "Hardware", "یراق‌آلات", "hinge", {
    children: [
      cat("hinges", "Hinges", "لولا", "hinge", {
        families: [
          fam(
            "butt-hinges",
            "Butt Hinges",
            "لولای ساده",
            "The standard door and panel hinge",
            "لولای استاندارد در و پنل",
            simpleGen("leafHeight", "Leaf Height", "ارتفاع بال", [1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6], ["18-8 Stainless Steel", "316 Stainless Steel", "Zinc-Plated Steel", "Brass", "6061 Aluminum"], {
              unit: '"',
              base: 320,
              cap: 260,
              packQty: 2,
              extraAxes: [
                widthAxis([1, 1.5, 2, 2.5, 3, 3.5, 4]),
                ax("pinType", "Pin Type", "نوع پین", ["Removable", "Non-Removable"]),
              ],
            }),
            { icon: "hinge" },
          ),
        ],
      }),
      cat("knobs-handles", "Knobs & Handles", "دستگیره و پیچ دستی", "knob", {
        families: [
          fam(
            "clamping-knobs",
            "Clamping Knobs",
            "پیچ دستی",
            "Hand-tightened knobs with a threaded stud or insert",
            "پیچ دستی با ساقه یا مهره رزوه‌دار",
            simpleGen("thread", "Thread Size", "اندازه رزوه", UNC_THREADS.slice(6, 16), ["Nylon 6/6", "Acetal", "6061 Aluminum", "Zinc"], {
              base: 380,
              cap: 220,
              extraAxes: [
                ax("style", "Style", "نوع", ["Three-Arm", "Four-Arm", "Knurled", "Wing"]),
                ax("studLength", "Stud Length", "طول ساقه", [0.5, 0.75, 1, 1.25, 1.5], { unit: '"', kind: "number" }),
              ],
            }),
            { icon: "knob" },
          ),
        ],
      }),
    ],
  }),

  // ====================== HEATING & COOLING ===============================
  cat("heating-cooling", "Heating & Cooling", "گرمایش و سرمایش", "fan", {
    children: [
      cat("fans-blowers", "Fans & Blowers", "فن و دمنده", "fan", {
        families: [
          fam(
            "axial-fans",
            "Axial Fans",
            "فن آکسیال",
            "Panel fans for cooling enclosures and machine cabinets",
            "فن پنلی برای خنک‌کاری تابلو و کابین ماشین‌آلات",
            simpleGen("frameSize", "Frame Size", "ابعاد قاب", ["40 mm", "60 mm", "80 mm", "92 mm", "120 mm", "172 mm", "220 mm"], ["Polypropylene", "6061 Aluminum"], {
              base: 1680,
              cap: 180,
              extraAxes: [
                ax("voltage", "Voltage", "ولتاژ", ["12V DC", "24V DC", "115V AC", "230V AC"]),
                ax("airflow", "Airflow, cfm", "دبی هوا (cfm)", [8, 17, 32, 55, 105, 240, 550], { kind: "number" }),
              ],
            }),
            { icon: "fan" },
          ),
        ],
      }),
      cat("heaters", "Heaters", "المنت و بخاری", "heater", {
        families: [
          fam(
            "cartridge-heaters",
            "Cartridge Heaters",
            "المنت کارتریجی",
            "Insert into a drilled hole to heat a mold or die",
            "درون سوراخ ماشین‌کاری‌شده برای گرم‌کردن قالب قرار می‌گیرد",
            simpleGen("diameter", "Diameter", "قطر", [0.25, 0.312, 0.375, 0.5, 0.625], ["18-8 Stainless Steel"], {
              unit: '"',
              base: 2450,
              cap: 200,
              extraAxes: [
                lengthInAxis([1, 1.5, 2, 3, 4, 6, 8, 10, 12]),
                ax("watts", "Wattage", "توان (وات)", [50, 100, 150, 200, 300, 400, 500, 750, 1000], { kind: "number" }),
                ax("voltage", "Voltage", "ولتاژ", ["120V", "240V"]),
              ],
            }),
            { icon: "heater" },
          ),
        ],
      }),
    ],
  }),

  // ====================== FURNITURE & STORAGE =============================
  cat("furniture-storage", "Furniture & Storage", "مبلمان و انبارش", "shelf", {
    children: [
      cat("shelving", "Shelving", "قفسه", "shelf", {
        families: [
          fam(
            "steel-shelving-units",
            "Steel Shelving Units",
            "قفسه فلزی",
            "Bolt-together shelving for stores and workshops",
            "قفسه پیچ‌شونده برای انبار و کارگاه",
            simpleGen("capacity", "Capacity per Shelf, lbs", "ظرفیت هر طبقه (پوند)", [350, 500, 800, 1200, 2000], ["Carbon Steel", "18-8 Stainless Steel"], {
              base: 21400,
              cap: 90,
              extraAxes: [
                ax("shelves", "Shelves", "تعداد طبقه", [3, 4, 5, 6], { kind: "number" }),
                ax("size", "Size (W x D x H)", "ابعاد", ['36" x 18" x 72"', '48" x 18" x 72"', '48" x 24" x 72"', '60" x 24" x 84"']),
              ],
            }),
            { icon: "shelf" },
          ),
        ],
      }),
      cat("workbenches", "Workbenches", "میز کار", "bench", {
        families: [
          fam(
            "steel-workbenches",
            "Steel Workbenches",
            "میز کار فلزی",
            "Heavy steel benches for assembly and repair",
            "میز فولادی سنگین برای مونتاژ و تعمیر",
            simpleGen("capacity", "Load Capacity, lbs", "ظرفیت بار (پوند)", [1000, 2000, 3000, 5000], ["Carbon Steel", "18-8 Stainless Steel"], {
              base: 48000,
              cap: 50,
              extraAxes: [
                ax("topMaterial", "Top Material", "جنس صفحه", ["Steel", "Stainless Steel", "Hardwood", "Laminate"]),
                ax("size", "Size (W x D)", "ابعاد", ['48" x 24"', '60" x 30"', '72" x 30"', '96" x 36"']),
              ],
            }),
            { icon: "bench" },
          ),
        ],
      }),
    ],
  }),

  // ========================== FABRICATING =================================
  cat("fabricating", "Fabricating", "ساخت و تولید", "weld", {
    children: [
      cat("welding", "Welding, Brazing & Soldering", "جوشکاری، برنج‌جوشی و لحیم‌کاری", "weld", {
        families: [
          fam(
            "welding-electrodes",
            "Welding Electrodes & Wire",
            "الکترود و سیم جوش",
            "Stick electrodes and MIG wire for steel and stainless",
            "الکترود دستی و سیم MIG برای فولاد و زنگ‌نزن",
            simpleGen("diameter", "Diameter", "قطر", [0.023, 0.03, 0.035, 0.045, 0.0625, 0.09375, 0.125, 0.15625], ["Carbon Steel", "18-8 Stainless Steel", "316 Stainless Steel", "6061 Aluminum"], {
              unit: '"',
              base: 2180,
              cap: 240,
              extraAxes: [
                ax("process", "Process", "فرآیند", ["Stick (SMAW)", "MIG (GMAW)", "TIG (GTAW)"]),
                ax("weight", "Weight", "وزن", ["1 lb", "2 lb", "10 lb", "33 lb"]),
              ],
            }),
            { icon: "weld" },
          ),
        ],
      }),
      cat("machine-tooling", "Machine Tooling", "ابزار ماشین", "endmill", {
        families: [
          fam(
            "end-mills",
            "End Mills",
            "فرز انگشتی",
            "Square and ball nose cutters for milling machines",
            "تیغه فرز تخت و گرد برای ماشین فرز",
            simpleGen("diameter", "Cutting Diameter", "قطر برش", [0.0625, 0.09375, 0.125, 0.1875, 0.25, 0.3125, 0.375, 0.5, 0.625, 0.75, 1], ["Tool Steel", "Ceramic"], {
              unit: '"',
              base: 1840,
              cap: 300,
              extraAxes: [
                ax("flutes", "Flutes", "تعداد لبه", [2, 3, 4, 6], { kind: "number" }),
                ax("endType", "End Type", "نوع نوک", ["Square", "Ball", "Corner Radius"]),
                ax("coating", "Coating", "پوشش", ["Uncoated", "TiN", "TiAlN", "AlTiN"]),
              ],
            }),
            { icon: "endmill" },
          ),
        ],
      }),
    ],
  }),

  // ==================== PLUMBING & JANITORIAL =============================
  cat("plumbing-janitorial", "Plumbing & Janitorial", "لوله‌کشی و نظافت", "faucet", {
    children: [
      cat("plumbing-fixtures", "Plumbing Fixtures", "شیرآلات بهداشتی", "faucet", {
        families: [
          fam(
            "utility-faucets",
            "Utility Faucets",
            "شیر خدماتی",
            "Hose-thread faucets for shop and utility sinks",
            "شیر با رزوه شیلنگ برای سینک کارگاهی و خدماتی",
            simpleGen("inletSize", "Inlet Size", "سایز ورودی", ['1/2"', '3/4"'], ["Brass", "316 Stainless Steel", "Chrome Plated" as string], {
              base: 3450,
              cap: 40,
              extraAxes: [ax("mount", "Mount", "نوع نصب", ["Wall", "Deck"]), ax("handleType", "Handle", "دسته", ["Single", "Double"])],
            }),
            { icon: "faucet" },
          ),
        ],
      }),
      cat("cleaning-supplies", "Cleaning Supplies", "لوازم نظافت", "broom", {
        families: [
          fam(
            "industrial-degreasers",
            "Industrial Degreasers",
            "چربی‌زدای صنعتی",
            "Cut oil and grease from machinery and shop floors",
            "حذف روغن و گریس از ماشین‌آلات و کف کارگاه",
            simpleGen("volume", "Volume", "حجم", ["32 oz", "1 gal", "5 gal", "55 gal"], ["None"], {
              base: 1840,
              cap: 40,
              extraAxes: [ax("type", "Type", "نوع", ["Water-Based", "Solvent-Based", "Citrus"])],
            }),
            { icon: "spray" },
          ),
        ],
      }),
    ],
  }),

  // ====================== BUILDING & GROUNDS ==============================
  cat("building-grounds", "Building & Grounds", "ساختمان و محوطه", "building", {
    children: [
      cat("doors-windows", "Doors & Windows", "در و پنجره", "door", {
        families: [
          fam(
            "strip-doors",
            "Strip Doors",
            "پرده نواری",
            "PVC strips keep temperature and dust separated between areas",
            "نوارهای PVC دما و گردوغبار را بین فضاها جدا نگه می‌دارد",
            simpleGen("stripWidth", "Strip Width", "عرض نوار", [6, 8, 12], ["PVC"], {
              unit: '"',
              base: 12400,
              cap: 60,
              extraAxes: [
                thicknessAxis([0.06, 0.08, 0.12]),
                ax("openingSize", "Opening Size", "ابعاد بازشو", ['4\' x 7\'', '6\' x 8\'', '8\' x 10\'', '10\' x 12\'']),
              ],
            }),
            { icon: "door" },
          ),
        ],
      }),
      cat("flooring-matting", "Flooring & Matting", "کفپوش و زیرانداز", "mat", {
        families: [
          fam(
            "anti-fatigue-mats",
            "Anti-Fatigue Mats",
            "کفپوش ضد خستگی",
            "Cushioned matting for standing workstations",
            "زیرانداز ضربه‌گیر برای ایستگاه‌های کاری ایستاده",
            simpleGen("size", "Size", "ابعاد", ['2\' x 3\'', '3\' x 5\'', '3\' x 10\'', '4\' x 6\''], ["Rubber", "Polyurethane", "PVC"], {
              base: 6800,
              cap: 90,
              extraAxes: [thicknessAxis([0.375, 0.5, 0.625, 0.75]), colorAxis(["Black", "Gray", "Yellow"])],
            }),
            { icon: "mat" },
          ),
        ],
      }),
    ],
  }),

  // ==================== OFFICE SUPPLIES & SIGNS ===========================
  cat("office-supplies-signs", "Office Supplies & Signs", "لوازم اداری و تابلو", "sign", {
    children: [
      cat("safety-signs", "Safety Signs", "تابلو ایمنی", "sign", {
        families: [
          fam(
            "warning-signs",
            "Warning Signs",
            "تابلو هشدار",
            "Standard-format signs for hazard areas",
            "تابلوهای استاندارد برای مناطق پرخطر",
            simpleGen("size", "Size", "ابعاد", ['7" x 10"', '10" x 14"', '14" x 20"'], ["6061 Aluminum", "Polypropylene", "Fiberglass"], {
              base: 890,
              cap: 140,
              extraAxes: [
                ax("header", "Header", "عنوان", ["Danger", "Warning", "Caution", "Notice"]),
                ax("language", "Language", "زبان", ["English", "Persian", "Bilingual"]),
              ],
            }),
            { icon: "sign" },
          ),
        ],
      }),
      cat("labeling", "Labeling", "برچسب‌گذاری", "label", {
        families: [
          fam(
            "wire-markers",
            "Wire Markers",
            "برچسب سیم",
            "Numbered markers for identifying conductors in a panel",
            "برچسب شماره‌دار برای شناسایی سیم‌ها در تابلو",
            simpleGen("wireGauge", "For Wire Gauge", "برای سایز سیم", ["22-16 AWG", "16-10 AWG", "10-6 AWG"], ["PVC", "Nylon"], {
              base: 1240,
              cap: 40,
              extraAxes: [ax("markings", "Markings", "علائم", ["0-9", "A-Z", "Blank"])],
            }),
            { icon: "label" },
          ),
        ],
      }),
    ],
  }),

  // ========================== SHIPPING ====================================
  cat("shipping", "Shipping", "بسته‌بندی و ارسال", "box", {
    children: [
      cat("boxes-containers", "Boxes & Containers", "کارتن و ظروف", "box", {
        families: [
          fam(
            "corrugated-boxes",
            "Corrugated Boxes",
            "کارتن مقوایی",
            "Single-wall and double-wall boxes in standard sizes",
            "کارتن یک‌لایه و دولایه در ابعاد استاندارد",
            simpleGen("size", "Size (L x W x H)", "ابعاد", ['6" x 6" x 6"', '8" x 8" x 8"', '12" x 9" x 6"', '12" x 12" x 12"', '18" x 12" x 10"', '24" x 18" x 12"'], ["Cardboard" as string], {
              base: 180,
              cap: 90,
              packQty: 25,
              extraAxes: [ax("wall", "Wall", "دیواره", ["Single Wall", "Double Wall"])],
            }),
            { icon: "box" },
          ),
        ],
      }),
      cat("packing-materials", "Packing Materials", "مواد بسته‌بندی", "tape", {
        families: [
          fam(
            "packing-tape",
            "Packing Tape",
            "نوار بسته‌بندی",
            "Carton sealing tape for shipping cases",
            "نوار چسب برای بستن کارتن ارسال",
            simpleGen("width", "Width", "عرض", [1.88, 2, 3], ["Polypropylene", "PVC"], {
              unit: '"',
              base: 340,
              cap: 40,
              packQty: 6,
              extraAxes: [ax("length", "Length", "طول", [55, 110], { unit: "yd", kind: "number" }), colorAxis(["Clear", "Brown"])],
            }),
            { icon: "tape" },
          ),
        ],
      }),
    ],
  }),

  // ========================= SUSPENDING ===================================
  cat("suspending", "Suspending", "آویز و نگهدارنده", "bracket", {
    children: [
      cat("brackets", "Brackets", "براکت", "bracket", {
        families: [
          fam(
            "shelf-brackets",
            "Shelf Brackets",
            "براکت قفسه",
            "L-brackets for mounting shelves and panels to a wall",
            "براکت L برای نصب قفسه و پنل روی دیوار",
            simpleGen("armLength", "Arm Length", "طول بازو", [4, 6, 8, 10, 12, 16, 20], ["Carbon Steel", "18-8 Stainless Steel", "6061 Aluminum"], {
              unit: '"',
              base: 480,
              cap: 180,
              packQty: 2,
              extraAxes: [
                ax("capacity", "Load Capacity, lbs", "ظرفیت بار (پوند)", [100, 250, 500, 750, 1000], { kind: "number" }),
                finishAxis(["Plain", "Zinc Plated", "Painted"]),
              ],
            }),
            { icon: "bracket" },
          ),
        ],
      }),
      cat("pipe-hangers", "Pipe Hangers", "بست آویز لوله", "hanger", {
        families: [
          fam(
            "clevis-hangers",
            "Clevis Pipe Hangers",
            "بست آویز کلویس",
            "Suspend horizontal pipe runs from threaded rod",
            "آویزکردن مسیر افقی لوله از میلگرد رزوه‌دار",
            simpleGen("pipeSize", "Pipe Size", "سایز لوله", PIPE_SIZES, ["Carbon Steel", "18-8 Stainless Steel", "Galvanized Steel"], {
              base: 420,
              cap: 160,
              packQty: 10,
              extraAxes: [ax("rodSize", "Rod Size", "سایز میلگرد", ['3/8"', '1/2"', '5/8"', '3/4"'])],
            }),
            { icon: "hanger" },
          ),
        ],
      }),
    ],
  }),
];
