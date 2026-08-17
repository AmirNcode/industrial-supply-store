import "server-only";

import { revalidatePath } from "next/cache";
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
  getFamilyForImport,
  writeImport,
} from "@/db/importQueries";

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
    }
  | { kind: "errors"; familyId: number; errors: ImportError[] }
  | { kind: "conflicts"; familyId: number; parts: string[] }
  | { kind: "case-variants"; familyId: number; parts: string[] }
  | {
      kind: "message";
      familyId: number;
      message:
        | "no-file"
        | "too-large"
        | "not-found"
        | "bad-plan"
        | "all-rows-skipped"
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
  if (problems.length > 0) return review(familyId, text, family, problems);

  const { rows, errors, skipped } = parseWithPlan(text, plan);
  if (errors.length > 0) return review(familyId, text, family, [], errors);
  if (rows.length === 0) {
    return { kind: "message", familyId, message: "all-rows-skipped" };
  }
  if (rows.length > IMPORT_MAX_ROWS) {
    return { kind: "message", familyId, message: "too-large" };
  }

  const existing = new Set(family.defs.map((definition) => definition.key));
  const addedColumns = plan.headers.filter(
    (header) => header.role === "spec" && !existing.has(header.key),
  ).length;

  const result = await writeImport(familyId, rows, plan);
  if (result.conflicts.length > 0) {
    return { kind: "conflicts", familyId, parts: result.conflicts };
  }
  if (result.caseVariants.length > 0) {
    return { kind: "case-variants", familyId, parts: result.caseVariants };
  }

  revalidatePath("/", "layout");
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
  };
}

async function review(
  familyId: number,
  text: string,
  family: NonNullable<Awaited<ReturnType<typeof getFamilyForImport>>>,
  problems: string[],
  knownRowProblems?: ImportError[],
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
  const proposed: ImportPlan = {
    headers: analysis.headers.map((header) => header.plan),
    dropKeys: [],
    mode: "update",
    skipBadRows: false,
  };
  const dryRun = knownRowProblems
    ? { errors: knownRowProblems }
    : validatePlan(proposed).length === 0
      ? parseWithPlan(text, proposed)
      : { errors: [] as ImportError[] };
  const badRows = new Set(dryRun.errors.map((error) => error.row));

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
    rowProblems: dryRun.errors,
    goodRows: analysis.rowCount - badRows.size,
  };
}
