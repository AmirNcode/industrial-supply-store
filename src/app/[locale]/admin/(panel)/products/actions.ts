"use server";

import { revalidatePath } from "next/cache";
import { assertAdminWrite } from "@/lib/admin";
import { parseWithPlan, pricelessParts, type ImportError } from "@/lib/importCsv";
import {
  analyzeCsv,
  parsePlanJson,
  validatePlan,
  type AnalyzedHeader,
  type MissingColumn,
} from "@/lib/columnPlan";
import {
  countProductsWithSpec,
  getFamilyForImport,
  writeImport,
} from "@/db/importQueries";

/**
 * Uploading a supplier's spreadsheet, in two stages through one form.
 *
 * Stage one reads the header and proposes what every column means; stage two
 * takes those decisions back and writes. Nothing is written in between, and the
 * file itself never leaves the browser between the two — the same form posts it
 * again with the confirmed plan, so there is no half-finished upload sitting on
 * the server waiting to expire.
 *
 * The result goes back through `useActionState`, not a redirect. A bad file can
 * produce thousands of errors, each naming a row, a column and a reason. That
 * does not fit in a query string, and truncating it would hide exactly the rows
 * someone needs to fix.
 */
export type ImportState =
  | {
      kind: "review";
      familyId: number;
      headers: AnalyzedHeader[];
      /** Columns the family has that this file does not carry. */
      missing: (MissingColumn & { productCount: number })[];
      rowCount: number;
      /** Set when a confirmed plan came back and could not be applied. */
      problems: string[];
    }
  | {
      kind: "ok";
      familyId: number;
      inserted: number;
      updated: number;
      addedColumns: number;
      droppedColumns: number;
      /** Imported without a price, so they render as "call for price". */
      priceless: string[];
      /** Written, but on_hold/sold disagreed with what the orders imply. */
      mismatches: { partNumber: string; column: string; uploaded: number; computed: number }[];
    }
  | { kind: "errors"; familyId: number; errors: ImportError[] }
  | { kind: "conflicts"; familyId: number; parts: string[] }
  | { kind: "case-variants"; familyId: number; parts: string[] }
  | {
      kind: "message";
      familyId: number;
      message: "no-file" | "too-large" | "not-found" | "bad-plan";
      detail?: string;
    };

const MAX_BYTES = 2_000_000;
const MAX_ROWS = 5_000;

export async function importCsvAction(
  _prev: ImportState | null,
  formData: FormData,
): Promise<ImportState> {
  await assertAdminWrite();

  const familyId = Number(formData.get("familyId"));
  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0) {
    return { kind: "message", familyId, message: "no-file" };
  }
  // Checked before reading the file into memory.
  if (file.size > MAX_BYTES) {
    return { kind: "message", familyId, message: "too-large" };
  }

  const family = await getFamilyForImport(familyId);
  if (!family) return { kind: "message", familyId, message: "not-found" };

  const text = await file.text();
  // Counted before parsing, so a file well inside the byte limit but made of
  // millions of tiny rows does not get parsed first and rejected after.
  if (text.split("\n").length > MAX_ROWS + 1) {
    return { kind: "message", familyId, message: "too-large" };
  }

  const rawPlan = formData.get("plan");
  const confirming = formData.get("stage") === "apply";

  // ------------------------------------------------------------------
  // Stage one: propose
  // ------------------------------------------------------------------
  if (!confirming) {
    return review(familyId, text, family, []);
  }

  // ------------------------------------------------------------------
  // Stage two: apply what was confirmed
  // ------------------------------------------------------------------
  const plan = parsePlanJson(rawPlan);
  if (!plan) return { kind: "message", familyId, message: "bad-plan" };

  const problems = validatePlan(plan);
  if (problems.length > 0) {
    // Back to the review screen carrying the reasons, rather than a dead end:
    // every one of these is fixed by changing a dropdown.
    return review(familyId, text, family, problems);
  }

  const { rows, errors } = parseWithPlan(text, plan);
  if (errors.length > 0) return { kind: "errors", familyId, errors };
  if (rows.length > MAX_ROWS) {
    return { kind: "message", familyId, message: "too-large" };
  }

  const existing = new Set(family.defs.map((d) => d.key));
  const addedColumns = plan.headers.filter(
    (h) => h.role === "spec" && !existing.has(h.key),
  ).length;

  const result = await writeImport(familyId, rows, plan);
  if (result.conflicts.length > 0) {
    return { kind: "conflicts", familyId, parts: result.conflicts };
  }
  if (result.caseVariants.length > 0) {
    return { kind: "case-variants", familyId, parts: result.caseVariants };
  }

  // Columns, product counts and facets have all changed, and every category
  // page is statically cached against them.
  revalidatePath("/", "layout");
  return {
    kind: "ok",
    familyId,
    inserted: result.inserted,
    updated: result.updated,
    addedColumns,
    droppedColumns: plan.dropKeys.length,
    priceless: pricelessParts(rows),
    mismatches: result.mismatches,
  };
}

/** Analyze the file and build the review screen's state. */
async function review(
  familyId: number,
  text: string,
  family: NonNullable<Awaited<ReturnType<typeof getFamilyForImport>>>,
  problems: string[],
): Promise<ImportState> {
  const analysis = analyzeCsv(text, family.defs, family.fieldAliases);
  if (!analysis.ok) {
    return { kind: "errors", familyId, errors: [{ row: 1, column: "", message: analysis.error }] };
  }
  if (analysis.rowCount > MAX_ROWS) {
    return { kind: "message", familyId, message: "too-large" };
  }

  // "Delete this column" should be a decision about known data.
  const counts = await countProductsWithSpec(
    familyId,
    analysis.missing.map((m) => m.key),
  );

  return {
    kind: "review",
    familyId,
    headers: analysis.headers,
    missing: analysis.missing.map((m) => ({ ...m, productCount: counts[m.key] ?? 0 })),
    rowCount: analysis.rowCount,
    problems,
  };
}
