"use server";

import { revalidatePath } from "next/cache";
import { assertAdminWrite } from "@/lib/admin";
import {
  createFamily,
  deleteCategory,
  deleteFamily,
  saveFamilyOrder,
} from "@/db/familyQueries";

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
