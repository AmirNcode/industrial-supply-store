"use server";

import { revalidatePath } from "next/cache";
import { assertAdminWrite } from "@/lib/admin";
import { parseImport, type ImportError } from "@/lib/importCsv";
import { getFamilyForImport, writeImport } from "@/db/importQueries";

/**
 * The result goes back through `useActionState`, not a redirect.
 *
 * A bad file can produce thousands of errors, each naming a row, a column and
 * a reason. That does not fit in a query string, and truncating it would hide
 * exactly the rows someone needs to fix.
 */
export type ImportState =
  | {
      kind: "ok";
      familyId: number;
      inserted: number;
      updated: number;
      /** Written, but on_hold/sold disagreed with what the orders imply. */
      mismatches: { partNumber: string; column: string; uploaded: number; computed: number }[];
    }
  | { kind: "errors"; familyId: number; errors: ImportError[] }
  | { kind: "conflicts"; familyId: number; parts: string[] }
  | { kind: "case-variants"; familyId: number; parts: string[] }
  | { kind: "message"; familyId: number; message: "no-file" | "too-large" | "not-found" };

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

  const { rows, errors } = parseImport(text, family.defs);
  if (errors.length > 0) return { kind: "errors", familyId, errors };
  if (rows.length > MAX_ROWS) {
    return { kind: "message", familyId, message: "too-large" };
  }

  const result = await writeImport(familyId, rows);
  if (result.conflicts.length > 0) {
    return { kind: "conflicts", familyId, parts: result.conflicts };
  }
  if (result.caseVariants.length > 0) {
    return { kind: "case-variants", familyId, parts: result.caseVariants };
  }

  // Product counts and facets have changed, and every category page is
  // statically cached against them.
  revalidatePath("/", "layout");
  return {
    kind: "ok",
    familyId,
    inserted: result.inserted,
    updated: result.updated,
    mismatches: result.mismatches,
  };
}
