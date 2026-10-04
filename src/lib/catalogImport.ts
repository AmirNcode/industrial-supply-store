import "server-only";

import { revalidateCatalogPages } from "./revalidateCatalog";
import { parseWithPlan, pricelessParts, type ImportError } from "./importCsv";
import {
  analyzeCsv,
  parsePlanJson,
  validatePlan,
  type AnalyzedHeader,
  type ImportPlan,
  type MissingColumn,
} from "./columnPlan";
import { IMPORT_MAX_ROWS, importTextTooLarge } from "./importLimits";
import {
  countProductsWithSpec,
  findForeignPartNumbers,
  getFamilyForImport,
  writeImport,
  type ForeignPart,
} from "@/db/importQueries";
import { FamilyCapacityExhausted, FamilyNumbersExhausted, PartNumberUnavailable } from "@/db/partNumberQueries";

export type ImportState =
  | {
      kind: "review";
      familyId: number;
      headers: AnalyzedHeader[];
      missing: (MissingColumn & { productCount: number })[];
      rowCount: number;
      problems: string[];
      rowProblems: ImportError[];
      goodRows: number;
      /** Rows whose part number cell is empty; each becomes a new product. */
      blankRows: number;
      /** Part numbers in the file that are not products of this family. */
      foreign: ForeignPart[];
      plan: ImportPlan;
    }
  | {
      kind: "ok";
      familyId: number;
      inserted: number;
      updated: number;
      removed: number;
      addedColumns: number;
      droppedColumns: number;
      skipped: ImportError[];
      priceless: string[];
      mismatches: { partNumber: string; column: string; uploaded: number; computed: number }[];
      /** Rows whose file part number could not be used, and what they got. */
      renumbered: { from: string; to: string }[];
    }
  | { kind: "errors"; familyId: number; errors: ImportError[] }
  | { kind: "conflicts"; familyId: number; parts: string[] }
  | { kind: "case-variants"; familyId: number; parts: string[] }
  | { kind: "reserved"; familyId: number; parts: string[] }
  | {
      kind: "message";
      familyId: number;
      message:
        | "no-file"
        | "too-large"
        | "not-found"
        | "bad-plan"
        | "all-rows-skipped"
        | "needs-numbers"
        | "numbers-exhausted"
        | "storage-missing"
        | "upload-failed"
        | "rate-limit";
      detail?: string;
    };

/**
 * Analyze or apply an already-authenticated catalog import.
 *
 * Transport is deliberately absent from this function. The browser uploads
 * the CSV directly to private object storage, and the small admin Route
 * Handler calls this after downloading and re-checking the bytes. That keeps
 * the 24 MB file out of Server Actions and Vercel's 4.5 MB function request
 * payload while preserving one validation/write implementation.
 */
export async function processCatalogImport(input: {
  familyId: number;
  text: string;
  stage: "review" | "apply";
  rawPlan?: unknown;
}): Promise<ImportState> {
  const { familyId, text } = input;
  if (!Number.isSafeInteger(familyId) || familyId <= 0) {
    return { kind: "message", familyId, message: "not-found" };
  }
  if (text.trim() === "") return { kind: "message", familyId, message: "no-file" };
  if (importTextTooLarge(text)) {
    return { kind: "message", familyId, message: "too-large" };
  }

  const family = await getFamilyForImport(familyId);
  if (!family) return { kind: "message", familyId, message: "not-found" };

  if (input.stage === "review") return review(familyId, text, family, []);

  const plan = parsePlanJson(input.rawPlan);
  if (!plan) return { kind: "message", familyId, message: "bad-plan" };

  const problems = validatePlan(plan);
  if (problems.length > 0) return review(familyId, text, family, problems, plan);

  const { rows, errors, skipped } = parseWithPlan(text, plan);
  if (errors.length > 0) return review(familyId, text, family, [], plan);
  if (rows.length === 0) {
    return { kind: "message", familyId, message: "all-rows-skipped" };
  }

  // Minting is the one part of an import that cannot be undone: a code, once
  // issued, is never reissued, so a mistaken upload burns numbers for good.
  // The operator has to ask for it on the review screen; a plan that arrived
  // without that decision is sent back rather than acted on.
  const blankRows = rows.filter((row) => row.partNumber === "").length;
  if (blankRows > 0 && plan.autoNumber !== true) {
    return review(familyId, text, family, [], plan);
  }
  if (rows.length > IMPORT_MAX_ROWS) {
    return { kind: "message", familyId, message: "too-large" };
  }

  // A part number in a file may only name a product this family already has.
  // Re-checked here, not trusted from the review: a product may have been
  // deleted, or moved, since the screen was drawn. The operator's only ways
  // on are new numbers for those rows or discarding the upload.
  const foreign = await findForeignPartNumbers(familyId, rows.map((row) => row.partNumber));
  if (foreign.length > 0 && plan.renumber !== true) {
    return review(familyId, text, family, [], plan);
  }
  const flagged = new Set(foreign.map((part) => part.partNumber.toUpperCase()));
  const renumbered = rows
    .filter((row) => flagged.has(row.partNumber.toUpperCase()))
    .map((row) => ({ from: row.partNumber, row }));
  // Blank, so `writeImport` mints for them exactly as for an empty cell.
  for (const { row } of renumbered) row.partNumber = "";

  const existing = new Set(family.defs.map((definition) => definition.key));
  const addedColumns = plan.headers.filter(
    (header) => header.role === "spec" && !existing.has(header.key),
  ).length;

  let result;
  try {
    result = await writeImport(familyId, rows, plan);
  } catch (error) {
    if (error instanceof PartNumberUnavailable) {
      return { kind: "reserved", familyId, parts: error.parts };
    }
    if (error instanceof FamilyCapacityExhausted || error instanceof FamilyNumbersExhausted) {
      return { kind: "message", familyId, message: "numbers-exhausted" };
    }
    throw error;
  }
  if (result.conflicts.length > 0) {
    return { kind: "conflicts", familyId, parts: result.conflicts };
  }
  if (result.caseVariants.length > 0) {
    return { kind: "case-variants", familyId, parts: result.caseVariants };
  }

  // Product counts on the cached catalog pages; family pages are per request.
  revalidateCatalogPages();
  return {
    kind: "ok",
    familyId,
    inserted: result.inserted,
    updated: result.updated,
    removed: result.removed,
    skipped,
    addedColumns,
    droppedColumns: plan.dropKeys.length,
    priceless: pricelessParts(rows),
    mismatches: result.mismatches,
    // `writeImport` writes each minted code back into the row it was handed.
    renumbered: renumbered.map(({ from, row }) => ({ from, to: row.partNumber })),
  };
}

async function review(
  familyId: number,
  text: string,
  family: NonNullable<Awaited<ReturnType<typeof getFamilyForImport>>>,
  problems: string[],
  submittedPlan?: ImportPlan,
): Promise<ImportState> {
  const analysis = analyzeCsv(text, family.defs, family.fieldAliases);
  if (!analysis.ok) {
    return {
      kind: "errors",
      familyId,
      errors: [{ row: 1, column: "", message: analysis.error }],
    };
  }
  if (analysis.rowCount > IMPORT_MAX_ROWS) {
    return { kind: "message", familyId, message: "too-large" };
  }

  const counts = await countProductsWithSpec(
    familyId,
    analysis.missing.map((missing) => missing.key),
  );
  const proposed: ImportPlan = submittedPlan ?? {
    headers: analysis.headers.map((header) => header.plan),
    dropKeys: [],
    mode: "update",
    skipBadRows: false,
  };
  // A preview retains valid rows even when other rows are invalid. Parsing in
  // all-or-nothing mode hides the blank codes that still need consent.
  const dryRun = validatePlan(proposed).length === 0
    ? parseWithPlan(text, { ...proposed, skipBadRows: true })
    : { rows: [], errors: [], skipped: [] };
  const rowProblems = [...dryRun.errors, ...dryRun.skipped];
  const badRows = new Set(rowProblems.map((error) => error.row));
  // Counted from the same dry run the operator is about to look at, so the
  // number on screen is the number of codes the apply would actually mint.
  const blankRows = dryRun.rows.filter((row) => row.partNumber === "").length;
  const foreign = await findForeignPartNumbers(familyId, dryRun.rows.map((row) => row.partNumber));

  return {
    kind: "review",
    familyId,
    headers: analysis.headers,
    missing: analysis.missing.map((missing) => ({
      ...missing,
      productCount: counts[missing.key] ?? 0,
    })),
    rowCount: analysis.rowCount,
    problems,
    rowProblems,
    goodRows: analysis.rowCount - badRows.size,
    blankRows,
    foreign,
    plan: proposed,
  };
}
