"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  cellText,
  productFingerprint,
  type CellId,
  type ProductRecord,
} from "@/lib/productTable";
import { getDict, type Locale } from "@/lib/i18n";
import { formatInt } from "@/lib/money";
import { saveFamilyProductsAction } from "./productTableActions";

/** What the workbench's leave-the-page guard needs from a family's products. */
export type ProductTableHandle = { save: () => Promise<boolean>; discard: () => void };

export type ProductDraft = Record<string, Partial<Record<CellId, string>>>;
/**
 * The outcome of the last Save. `invalid` and `stale` are errors the desktop
 * shows like any other; the phone gives them their own banners.
 */
export type ProductNotice = { kind: "ok" | "error" | "invalid" | "stale"; text: string };

/**
 * Every row loaded so far in this family, by part number. `index` is the
 * row's position in the family's full list; a row reached only through a
 * part-number search has none, because the search does not say where it sits.
 */
export type KnownProducts = ReadonlyMap<string, { product: ProductRecord; index?: number }>;

export const cellKey = (partNumber: string, cell: CellId) => `${partNumber}\u0000${cell}`;

/**
 * A family's unsaved product edits, and the one Save that writes them.
 *
 * Shared by the desktop table and the phone's product list, which load rows
 * differently — a page at a time there, accumulating here — but must edit,
 * check and save them by exactly the same rules. A cell counts as edited only
 * while it differs from what was loaded, so typing a value back clears it.
 * Every cell must pass before anything is written.
 *
 * Every row ever loaded is remembered in `known`, so an edit made on one page
 * is still saved — with the fingerprint it was loaded with — after the person
 * has moved on to another.
 */
export function useProductDrafts({
  familyId,
  locale,
  onPendingChange,
  onSaved,
  onInvalid,
  onStale,
}: {
  familyId: number;
  locale: Locale;
  onPendingChange: (changedProducts: number) => void;
  /** The stored rows that replace the edited ones. */
  onSaved: (fresh: ReadonlyMap<string, ProductRecord>) => void;
  /** Where the first refused row sits in the family's list, when known. */
  onInvalid: (first: { partNumber: string; index?: number }) => void;
  /** Rows changed underneath: reload them, keeping the edits on top. */
  onStale: () => void;
}) {
  const t = getDict(locale);
  const router = useRouter();
  const [draft, setDraft] = useState<ProductDraft>({});
  const [invalid, setInvalid] = useState<ReadonlySet<string>>(() => new Set());
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<ProductNotice | null>(null);
  const [known, setKnown] = useState<KnownProducts>(() => new Map());

  const changed = Object.keys(draft).length;

  useEffect(() => {
    onPendingChange(changed);
  }, [changed, onPendingChange]);
  useEffect(() => () => onPendingChange(0), [onPendingChange]);

  /** Note rows as loaded; `start` is the first one's position, if known. */
  function remember(products: readonly ProductRecord[], start: number | null) {
    setKnown((previous) => {
      const next = new Map(previous);
      products.forEach((product, i) => {
        const index = start === null ? previous.get(product.partNumber)?.index : start + i;
        next.set(product.partNumber, { product, index });
      });
      return next;
    });
  }

  /**
   * Nothing loaded still holds, e.g. after an import refreshed the page —
   * except the rows with unsaved edits. Save sends only rows it has a record
   * of, so dropping those would silently drop the edits on every page but the
   * one reloaded. They keep the version they were edited against; if that
   * has changed underneath, the server says so and nothing is lost.
   */
  function forget() {
    setKnown((previous) => {
      const next = new Map<string, { product: ProductRecord; index?: number }>();
      for (const partNumber of Object.keys(draft)) {
        const entry = previous.get(partNumber);
        if (entry) next.set(partNumber, entry);
      }
      return next;
    });
  }

  function change(product: ProductRecord, cell: CellId, value: string) {
    setDraft((previous) => {
      const row = { ...previous[product.partNumber] };
      if (value === cellText(product, cell)) delete row[cell];
      else row[cell] = value;
      const next = { ...previous };
      if (Object.keys(row).length === 0) delete next[product.partNumber];
      else next[product.partNumber] = row;
      return next;
    });
    const key = cellKey(product.partNumber, cell);
    if (invalid.has(key)) {
      setInvalid((previous) => {
        const next = new Set(previous);
        next.delete(key);
        return next;
      });
    }
  }

  function discard() {
    setDraft({});
    setInvalid(new Set());
    setNotice(null);
  }

  async function save(): Promise<boolean> {
    if (saving) return false;
    if (changed === 0) return true;
    setSaving(true);
    setNotice(null);
    const payload = Object.entries(draft).flatMap(([partNumber, edits]) => {
      const product = known.get(partNumber)?.product;
      return product ? [{ partNumber, fingerprint: productFingerprint(product), edits }] : [];
    });
    try {
      const result = await saveFamilyProductsAction(familyId, payload);
      if (result.kind === "saved") {
        // The stored rows replace the edited ones in the same render as the
        // draft clears, so the list never flashes the old values.
        const fresh = new Map(result.products.map((product) => [product.partNumber, product]));
        onSaved(fresh);
        setKnown((previous) => {
          const next = new Map(previous);
          for (const [partNumber, product] of fresh) {
            const entry = next.get(partNumber);
            if (entry) next.set(partNumber, { ...entry, product });
          }
          return next;
        });
        setDraft({});
        setInvalid(new Set());
        setNotice({ kind: "ok", text: t.productsSaved.replace("{n}", formatInt(result.count, locale)) });
        // The tree's stock counts; `refreshKey` then reloads these rows too.
        router.refresh();
        return true;
      }
      if (result.kind === "invalid") {
        setInvalid(new Set(result.cells.map(({ partNumber, cell }) => cellKey(partNumber, cell))));
        const partNumber = result.cells[0]?.partNumber;
        if (partNumber) onInvalid({ partNumber, index: known.get(partNumber)?.index });
        setNotice({
          kind: "invalid",
          text: t.productsInvalid.replace("{n}", formatInt(result.cells.length, locale)),
        });
      } else if (result.kind === "stale") {
        // Fresh rows under the same edits: the person checks, then saves again.
        onStale();
        setNotice({
          kind: "stale",
          text: t.productsStale.replace("{n}", formatInt(result.partNumbers.length, locale)),
        });
      } else {
        setNotice({ kind: "error", text: t.productsSaveFailed });
      }
      return false;
    } catch {
      setNotice({ kind: "error", text: t.productsSaveFailed });
      return false;
    } finally {
      setSaving(false);
    }
  }

  return {
    draft,
    invalid,
    known,
    saving,
    notice,
    setNotice,
    changed,
    remember,
    forget,
    change,
    discard,
    save,
  };
}
