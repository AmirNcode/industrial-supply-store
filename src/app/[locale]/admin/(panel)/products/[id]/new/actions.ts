"use server";

import { revalidatePath } from "next/cache";
import { assertAdminWrite } from "@/lib/admin";
import { getFamilyForImport, writeImport } from "@/db/importQueries";
import { parseNumeric } from "@/lib/columnPlan";
import { normalizeCatalogImageUrl } from "@/lib/catalogImages";
import type { ImportRow } from "@/lib/importCsv";

export type CreateProductState =
  | { kind: "ok"; partNumber: string }
  | { kind: "error"; message: string; column?: string };

/**
 * One product, written through the same path as a one-row CSV import.
 *
 * Reusing `writeImport` is deliberate: the product count on the family and its
 * ancestors, the facet index behind the filters, and the inventory
 * reconciliation against open orders all live in there. A second insert path
 * would be a second place for those to drift out of step.
 */
export async function createProductAction(
  familyId: number,
  form: FormData,
): Promise<CreateProductState> {
  await assertAdminWrite();

  const family = await getFamilyForImport(familyId);
  if (!family) return { kind: "error", message: "not-found" };

  const specs: Record<string, string | number> = {};
  for (const def of family.defs) {
    const raw = String(form.get(`spec.${def.key}`) ?? "").trim();
    // Empty means the product has no value for that spec, exactly as a blank
    // cell does in an uploaded file.
    if (raw === "") continue;
    if (def.kind === "number") {
      const parsed = parseNumeric(raw);
      if (parsed === null) {
        return { kind: "error", message: "bad-number", column: def.key };
      }
      specs[def.key] = parsed;
    } else {
      specs[def.key] = raw;
    }
  }

  /** A whole count, or the fallback when the field is left empty. */
  function count(name: string, fallback: number): number | null {
    const raw = String(form.get(name) ?? "").trim();
    if (raw === "") return fallback;
    const parsed = parseNumeric(raw);
    if (parsed === null || parsed < 0 || !Number.isInteger(parsed)) return null;
    return parsed;
  }

  const packQty = count("pack_qty", 1);
  const leadDays = count("lead_days", 0);
  const available = count("inventory_available", 0);
  if (packQty === null || packQty < 1) return { kind: "error", message: "bad-pack" };
  if (leadDays === null) return { kind: "error", message: "bad-lead" };
  if (available === null) return { kind: "error", message: "bad-inventory" };

  // Blank price is call-for-price, the same as an empty price cell in a file.
  const priceRaw = String(form.get("price_usd") ?? "").trim();
  let priceCents = 0;
  if (priceRaw !== "") {
    const price = parseNumeric(priceRaw);
    if (price === null || price < 0) return { kind: "error", message: "bad-price" };
    priceCents = Math.round(price * 100);
  }

  const imageRaw = String(form.get("image_url") ?? "").trim();
  const imageUrl = imageRaw === "" ? undefined : normalizeCatalogImageUrl(imageRaw);
  if (imageRaw !== "" && imageUrl === null) return { kind: "error", message: "bad-image" };

  const row: ImportRow = {
    // Blank mints a code, the same rule the uploader follows. A typed value is
    // kept as given, so a supplier's own code can still be recorded.
    partNumber: String(form.get("part_number") ?? "").trim(),
    specs,
    priceCents,
    packQty,
    leadDays,
    inStock: form.get("in_stock") === "on",
    inventoryAvailable: available,
    // Held and sold are derived from orders, never typed in.
    inventoryOnHold: 0,
    inventorySold: 0,
    imageUrl: imageUrl ?? undefined,
  };

  const result = await writeImport(familyId, [row]);
  if (result.conflicts.length > 0) {
    return { kind: "error", message: "wrong-family", column: result.conflicts[0] };
  }
  if (result.caseVariants.length > 0) {
    return { kind: "error", message: "case-variant", column: result.caseVariants[0] };
  }
  if (result.inserted + result.updated !== 1) return { kind: "error", message: "not-created" };

  revalidatePath("/", "layout");
  // `writeImport` fills the minted code into the row it was handed.
  return { kind: "ok", partNumber: row.partNumber };
}
