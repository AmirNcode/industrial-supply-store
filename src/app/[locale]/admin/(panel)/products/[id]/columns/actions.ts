"use server";

import { assertAdminWrite } from "@/lib/admin";
import { saveColumns, type ColumnEdit } from "@/db/columnQueries";

export type ColumnsState =
  | { kind: "idle" }
  | { kind: "saved"; deleted: number }
  | { kind: "error"; message: string };

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

  await saveColumns(familyId, parsed.edits, parsed.dropKeys);

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
  return { kind: "saved", deleted: parsed.dropKeys.length };
}

function parseEdits(
  raw: unknown,
): { edits: ColumnEdit[]; dropKeys: string[] } | null {
  if (typeof raw !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const { edits, dropKeys } = parsed as Record<string, unknown>;
  if (!Array.isArray(edits) || !Array.isArray(dropKeys)) return null;
  if (!dropKeys.every((k): k is string => typeof k === "string")) return null;

  const out: ColumnEdit[] = [];
  for (const e of edits) {
    if (typeof e !== "object" || e === null) return null;
    const o = e as Record<string, unknown>;
    if (typeof o.key !== "string" || o.key === "") return null;
    if (typeof o.labelEn !== "string" || typeof o.labelFa !== "string") return null;
    if (typeof o.unit !== "string") return null;
    if (o.kind !== "number" && o.kind !== "text") return null;
    if (typeof o.inTable !== "boolean" || typeof o.inDetail !== "boolean") return null;
    if (typeof o.filterable !== "boolean") return null;
    if (typeof o.mobile !== "boolean") return null;
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

  return { edits: out, dropKeys };
}
