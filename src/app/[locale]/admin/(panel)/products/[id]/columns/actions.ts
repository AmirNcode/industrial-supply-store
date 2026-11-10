"use server";

import { assertAdminWrite } from "@/lib/admin";
import { ColumnKeyTaken, getEditableDefs, saveColumns, type ColumnEdit } from "@/db/columnQueries";
import { newColumnHasContent, resolveNewColumns, type NewColumn, type NewColumnError } from "@/lib/newColumns";

export type ColumnsState =
  | { kind: "idle" }
  /** `added` is what was created, normalised, so the editor can show it as saved rows. */
  | { kind: "saved"; deleted: number; added: NewColumn[] }
  | { kind: "error"; message: string }
  /** A new column was refused; the editor words it in the page's language. */
  | { kind: "newColumn"; error: NewColumnError };

/**
 * Save a family's edited columns.
 *
 * The edits arrive as one JSON field, like the import plan and for the same
 * reason: a family with forty-seven columns would otherwise be several hundred
 * named inputs reassembled by index. Everything in it is validated here, since
 * a form field is whatever the client sends.
 */
export async function saveColumnsAction(
  _prev: ColumnsState | null,
  formData: FormData,
): Promise<ColumnsState> {
  await assertAdminWrite();

  const familyId = Number(formData.get("familyId"));
  if (!Number.isInteger(familyId) || familyId <= 0) {
    return { kind: "error", message: "That family no longer exists." };
  }

  const parsed = parseEdits(formData.get("edits"));
  if (!parsed) {
    return { kind: "error", message: "Those changes could not be read. Reload and try again." };
  }

  /*
   * New columns are checked against what the database holds now, not only
   * against what the editor sent: a column created from another tab since this
   * page loaded is not in the editor's list, and two of the same key would be
   * one heading the import cannot tell apart.
   */
  const adding = parsed.adds.some(newColumnHasContent);
  const stored = adding ? (await getEditableDefs(familyId)).map((d) => d.key) : [];
  const adds = resolveNewColumns(parsed.adds, [
    ...stored,
    ...parsed.edits.map((e) => e.key),
    ...parsed.dropKeys,
  ]);
  if (!adds.ok) return { kind: "newColumn", error: adds.error };

  try {
    await saveColumns(familyId, parsed.edits, parsed.dropKeys, adds.columns);
  } catch (error) {
    if (error instanceof ColumnKeyTaken) {
      return { kind: "newColumn", error: { code: "duplicate", key: error.key } };
    }
    throw error;
  }

  /*
   * No revalidation, deliberately.
   *
   * This used to be `revalidatePath("/", "layout")`, a whole-site purge on a
   * button an operator presses repeatedly — the exact pattern
   * `docs/ARCHITECTURE.md` forbids, and the one behind the 2026-08-15 incident.
   * It also broke this page: the purge made the router replace the editor with
   * a re-mounted copy, which re-seeded its state from the payload the page had
   * loaded with, so a save that had just committed correctly appeared to snap
   * back to the old values until a manual reload.
   *
   * Nothing needs purging. Every surface that reads `spec_defs` — the family
   * page, the category list view, this editor — is dynamic and already renders
   * per request; the prerendered pages (home, category cards) show family names
   * and descriptions, never spec columns. If a route that displays columns is
   * ever given `generateStaticParams`, it must be revalidated by path here.
   */
  return { kind: "saved", deleted: parsed.dropKeys.length, added: adds.columns };
}

function parseEdits(
  raw: unknown,
): { edits: ColumnEdit[]; dropKeys: string[]; adds: NewColumn[] } | null {
  if (typeof raw !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const { edits, dropKeys, adds = [] } = parsed as Record<string, unknown>;
  if (!Array.isArray(edits) || !Array.isArray(dropKeys) || !Array.isArray(adds)) return null;
  if (!dropKeys.every((k): k is string => typeof k === "string")) return null;

  const out: ColumnEdit[] = [];
  for (const e of edits) {
    const o = readColumn(e);
    if (!o || o.key === "") return null;
    out.push({
      key: o.key,
      // A blank heading renders as a column nobody can identify, so the key
      // stands in rather than nothing.
      labelEn: o.labelEn.trim() || o.key,
      labelFa: o.labelFa.trim() || o.labelEn.trim() || o.key,
      unit: o.unit.trim(),
      kind: o.kind,
      inTable: o.inTable,
      inDetail: o.inDetail,
      filterable: o.filterable,
      mobile: o.mobile,
    });
  }

  // A column cannot be both edited and deleted; the editor never sends both,
  // and honouring one arbitrarily would make the outcome depend on statement
  // order.
  const dropping = new Set(dropKeys);
  if (out.some((e) => dropping.has(e.key))) return null;

  // New rows are passed through as typed; `resolveNewColumns` decides their
  // keys and labels, so here they only have to be the right shape.
  const newRows: NewColumn[] = [];
  for (const a of adds) {
    const o = readColumn(a);
    if (!o) return null;
    newRows.push(o);
  }

  return { edits: out, dropKeys, adds: newRows };
}

/** One column's fields, type-checked; null if any is missing or the wrong type. */
function readColumn(raw: unknown): NewColumn | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.key !== "string") return null;
  if (typeof o.labelEn !== "string" || typeof o.labelFa !== "string") return null;
  if (typeof o.unit !== "string") return null;
  if (o.kind !== "number" && o.kind !== "text") return null;
  if (typeof o.inTable !== "boolean" || typeof o.inDetail !== "boolean") return null;
  if (typeof o.filterable !== "boolean") return null;
  if (typeof o.mobile !== "boolean") return null;
  return {
    key: o.key,
    labelEn: o.labelEn,
    labelFa: o.labelFa,
    unit: o.unit,
    kind: o.kind,
    inTable: o.inTable,
    inDetail: o.inDetail,
    filterable: o.filterable,
    mobile: o.mobile,
  };
}
