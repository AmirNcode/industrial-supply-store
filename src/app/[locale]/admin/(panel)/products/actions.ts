"use server";

import { revalidatePath } from "next/cache";
import { assertAdminWrite } from "@/lib/admin";
import { parseWithPlan, pricelessParts, type ImportError } from "@/lib/importCsv";
import {
  analyzeCsv,
  parsePlanJson,
  validatePlan,
  type AnalyzedHeader,
  type ImportPlan,
  type MissingColumn,
} from "@/lib/columnPlan";
import {
  countProductsWithSpec,
  getFamilyForImport,
  writeImport,
} from "@/db/importQueries";
import {
  createFamily,
  deleteCategory,
  deleteFamily,
  saveFamilyOrder,
} from "@/db/familyQueries";

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
      /**
       * Rows the file cannot import as they stand — duplicate part numbers, a
       * blank one, a ragged row, a word where a number belongs.
       *
       * Found at this stage rather than at confirm so they are visible before
       * anyone spends time on the columns, and offered with a way through:
       * skipping three bad rows should not mean editing the file and starting
       * the column mapping again.
       */
      rowProblems: ImportError[];
      /** How many rows would import if the bad ones were skipped. */
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
      /** Rows left out at the operator's request, with the reason for each. */
      skipped: ImportError[];
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
      message:
        | "no-file"
        | "too-large"
        | "not-found"
        | "bad-plan"
        | "all-rows-skipped";
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
  /*
   * The file's text, not the file.
   *
   * An import is two posts and React empties a file input once the first one
   * resolves, so the browser reads the file when it is chosen and sends the
   * text with both. The limits below therefore measure the string.
   */
  const text = formData.get("csvText");
  if (typeof text !== "string" || text.trim() === "") {
    return { kind: "message", familyId, message: "no-file" };
  }
  if (text.length > MAX_BYTES) {
    return { kind: "message", familyId, message: "too-large" };
  }
  // Counted before parsing, so a file well inside the size limit but made of
  // millions of tiny rows does not get parsed first and rejected after.
  if (text.split("\n").length > MAX_ROWS + 1) {
    return { kind: "message", familyId, message: "too-large" };
  }

  const family = await getFamilyForImport(familyId);
  if (!family) return { kind: "message", familyId, message: "not-found" };

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

  const { rows, errors, skipped } = parseWithPlan(text, plan);
  // Back to the review screen rather than a dead end: the operator's column
  // choices are still on screen, and ticking "skip the bad rows" is the fix.
  if (errors.length > 0) return review(familyId, text, family, [], errors);
  if (rows.length === 0) {
    return { kind: "message", familyId, message: "all-rows-skipped" };
  }
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
    removed: result.removed,
    skipped,
    addedColumns,
    droppedColumns: plan.dropKeys.length,
    priceless: pricelessParts(rows),
    mismatches: result.mismatches,
  };
}

export type NewFamilyState =
  | { kind: "created"; name: string }
  | { kind: "error"; message: "no-name" | "no-category" };

/**
 * Create an empty family for an upload to target.
 *
 * It starts with no columns at all, which is the point: the first CSV uploaded
 * into it defines them.
 */
export async function createFamilyAction(
  _prev: NewFamilyState | null,
  formData: FormData,
): Promise<NewFamilyState> {
  await assertAdminWrite();

  const result = await createFamily(
    Number(formData.get("categoryId")),
    String(formData.get("nameEn") ?? ""),
    String(formData.get("nameFa") ?? ""),
  );
  if (!result.ok) return { kind: "error", message: result.reason };

  revalidatePath("/", "layout");
  return { kind: "created", name: String(formData.get("nameEn") ?? "").trim() };
}

export type FamilyOrderResult = "saved" | "stale";

/**
 * Commit one category's family order.
 *
 * Typed arguments rather than a `FormData`, because this is called directly
 * from a transition instead of by submitting a form. The buttons live inside
 * the group's `<summary>`, which cancels the click's default action so that
 * pressing one does not also collapse the group it belongs to — and a
 * cancelled click never submits a form.
 *
 * `"stale"` means the arrangement no longer describes the category: a family
 * was added or deleted elsewhere while this page sat open. Nothing is written,
 * and the page says so rather than silently applying a partial order.
 */
export async function saveFamilyOrderAction(
  categoryId: number,
  orderedIds: number[],
): Promise<FamilyOrderResult> {
  await assertAdminWrite();

  if (!Number.isInteger(categoryId) || categoryId <= 0) return "stale";
  if (!Array.isArray(orderedIds)) return "stale";
  if (!orderedIds.every((id) => Number.isInteger(id) && id > 0)) return "stale";

  if (!(await saveFamilyOrder(categoryId, orderedIds))) return "stale";

  /*
   * Only the category pages, not the whole layout.
   *
   * Family order is rendered by exactly two things: this admin page, which is
   * dynamic and uncached, and the ISR category pages. The layout-wide purge
   * the other actions use would also invalidate the home pages, quick order
   * and search — and a whole-site purge per reorder is the regeneration storm
   * behind the 2026-08-15 production incident. Batching a session's moves
   * behind one Save button keeps this to one purge per category, rather than
   * one per arrow press.
   */
  revalidatePath("/[locale]/c/[...slug]", "page");
  return "saved";
}

export type DeleteState =
  | { kind: "deleted"; what: "family" | "category"; name: string; products: number }
  | { kind: "error"; message: "not-found" | "not-confirmed" };

/**
 * Delete a family or a whole category subtree.
 *
 * Guarded by a typed confirmation rather than a dialog: the button sits in a
 * list of a hundred, and this is the one action on the page that cannot be
 * undone. `assertAdminWrite` still refuses under DEMO_MODE, so a hand-made POST
 * gets the same answer as a disabled button.
 */
export async function deleteCatalogAction(
  _prev: DeleteState | null,
  formData: FormData,
): Promise<DeleteState> {
  await assertAdminWrite();

  const id = Number(formData.get("id"));
  const what = formData.get("what") === "category" ? "category" : "family";
  const name = String(formData.get("name") ?? "");
  const products = Number(formData.get("products")) || 0;

  // The word is checked here, not only in the browser.
  if (String(formData.get("confirm") ?? "").trim().toUpperCase() !== "DELETE") {
    return { kind: "error", message: "not-confirmed" };
  }

  const ok =
    what === "category" ? await deleteCategory(id) : await deleteFamily(id);
  if (!ok) return { kind: "error", message: "not-found" };

  revalidatePath("/", "layout");
  return { kind: "deleted", what, name, products };
}

/** Analyze the file and build the review screen's state. */
async function review(
  familyId: number,
  text: string,
  family: NonNullable<Awaited<ReturnType<typeof getFamilyForImport>>>,
  problems: string[],
  /** Row errors already found by a rejected confirm; recomputed if absent. */
  knownRowProblems?: ImportError[],
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

  /*
   * Read the rows against the proposal to find what is wrong with the file
   * itself.
   *
   * The proposal is what the screen opens with, so this is what the operator
   * would hit on confirming without changing anything. Errors that depend on a
   * choice they later make — text in a column they mark numeric — are caught at
   * confirm and routed back here.
   */
  const proposed: ImportPlan = {
    headers: analysis.headers.map((h) => h.plan),
    dropKeys: [],
    mode: "update",
    skipBadRows: false,
  };
  const dryRun = knownRowProblems
    ? { errors: knownRowProblems }
    : validatePlan(proposed).length === 0
      ? parseWithPlan(text, proposed)
      : { errors: [] as ImportError[] };

  const badRows = new Set(dryRun.errors.map((e) => e.row));

  return {
    kind: "review",
    familyId,
    headers: analysis.headers,
    missing: analysis.missing.map((m) => ({ ...m, productCount: counts[m.key] ?? 0 })),
    rowCount: analysis.rowCount,
    problems,
    rowProblems: dryRun.errors,
    goodRows: analysis.rowCount - badRows.size,
  };
}
