"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  cellText,
  newRowHasContent,
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
/** A new row's cells have no part number yet; keyed by the row's id instead. */
export const newCellKey = (id: number, cell: CellId) => `\u0000new${id}\u0000${cell}`;

/** The cells typed into one new row. */
export type NewRowDraft = Partial<Record<CellId, string>>;

/**
 * A product not saved yet. `id` is stable for the life of the edit, unlike a
 * position: rows can be removed, and a copy has to keep pointing at its source.
 */
export type NewRow = {
  id: number;
  cells: NewRowDraft;
  /**
   * Where a copy came from, and which cells it took. Save refuses a copy that
   * still matches its source in every one of them but stock: that would be
   * the same product twice under two part numbers.
   */
  copyOf?: { partNumber: string; cells: CellId[] } | { newId: number };
};

/** What an unset cell of a new row means: in stock, everything else blank. */
const newRowValue = (row: NewRow, cell: CellId) => (row.cells[cell] ?? (cell === "inStock" ? "yes" : "")).trim();

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
  // New products typed into the table's blank rows. The phone list never adds
  // any, so for it this stays empty and Save behaves exactly as before.
  const [newRows, setNewRows] = useState<NewRow[]>([]);
  // The id the next new row gets — also the trailing blank row's key, so the
  // input someone starts typing in is the same element once it becomes a row.
  const [nextNewId, setNextNewId] = useState(1);
  /** Copies refused for matching their source, with the source's part number ("" for a new row). */
  const [sameAs, setSameAs] = useState<ReadonlyMap<number, string>>(() => new Map());

  const filledNewRows = newRows.filter((row) => newRowHasContent(row.cells));
  const changed = Object.keys(draft).length + filledNewRows.length;

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

  /** Forget a new row's refusals once someone changes it. */
  function clearNewRowMarks(id: number, cell?: CellId) {
    if (cell !== undefined) {
      const key = newCellKey(id, cell);
      if (invalid.has(key)) {
        setInvalid((previous) => {
          const next = new Set(previous);
          next.delete(key);
          return next;
        });
      }
    }
    if (sameAs.has(id)) {
      setSameAs((previous) => {
        const next = new Map(previous);
        next.delete(id);
        return next;
      });
    }
  }

  /**
   * A cell of new row `id`, or — with `id` null — of the trailing blank row,
   * which becomes a row of its own on the first keystroke. Rows emptied again
   * stay where they are and are simply not sent; Remove takes one out.
   */
  function changeNew(id: number | null, cell: CellId, value: string) {
    const rowId = id ?? nextNewId;
    if (id === null) setNextNewId(nextNewId + 1);
    setNewRows((previous) => {
      const existing = previous.find((row) => row.id === rowId);
      const cells = { ...existing?.cells };
      if (value === "") delete cells[cell];
      else cells[cell] = value;
      return existing
        ? previous.map((row) => (row.id === rowId ? { ...row, cells } : row))
        : [...previous, { id: rowId, cells }];
    });
    clearNewRowMarks(rowId, cell);
  }

  /** A copy at the end of the new rows; returns its id so the table can focus it. */
  function addCopy(cells: NewRowDraft, copyOf: NonNullable<NewRow["copyOf"]>): number {
    const id = nextNewId;
    setNextNewId(id + 1);
    setNewRows((previous) => [...previous, { id, cells, copyOf }]);
    return id;
  }

  function removeNew(id: number) {
    setNewRows((previous) => previous.filter((row) => row.id !== id));
    setInvalid((previous) => new Set([...previous].filter((key) => !key.startsWith(`\u0000new${id}\u0000`))));
    clearNewRowMarks(id);
  }

  /**
   * The copies still identical to their source in every cell they took, stock
   * aside — stock is the one cell a copy is expected to differ in, and it is
   * cleared on copying. A source no longer loaded or no longer there is not
   * compared: there is nothing left to be a duplicate of.
   */
  function unchangedCopies(): Map<number, string> {
    const found = new Map<number, string>();
    for (const row of newRows) {
      const copyOf = row.copyOf;
      if (!copyOf || !newRowHasContent(row.cells)) continue;
      if ("partNumber" in copyOf) {
        const product = known.get(copyOf.partNumber)?.product;
        if (!product) continue;
        const edits = draft[copyOf.partNumber];
        const same = copyOf.cells
          .filter((cell) => cell !== "qty")
          .every((cell) => newRowValue(row, cell) === (edits?.[cell] ?? cellText(product, cell)).trim());
        if (same) found.set(row.id, copyOf.partNumber);
      } else {
        const source = newRows.find((other) => other.id === copyOf.newId);
        if (!source) continue;
        const cells = new Set([...Object.keys(row.cells), ...Object.keys(source.cells)] as CellId[]);
        cells.delete("qty");
        if ([...cells].every((cell) => newRowValue(row, cell) === newRowValue(source, cell))) {
          found.set(row.id, "");
        }
      }
    }
    return found;
  }

  function discard() {
    setDraft({});
    setNewRows([]);
    setSameAs(new Map());
    setInvalid(new Set());
    setNotice(null);
  }

  async function save(): Promise<boolean> {
    if (saving) return false;
    if (changed === 0) return true;
    const copies = unchangedCopies();
    setSameAs(copies);
    if (copies.size > 0) {
      setNotice({
        kind: "invalid",
        text: t.productsUnchangedCopies.replace("{n}", formatInt(copies.size, locale)),
      });
      return false;
    }
    setSaving(true);
    setNotice(null);
    const payload = Object.entries(draft).flatMap(([partNumber, edits]) => {
      const product = known.get(partNumber)?.product;
      return product ? [{ partNumber, fingerprint: productFingerprint(product), edits }] : [];
    });
    // Sent without the empty ones and by position; `sent` maps a refused
    // cell back to the row it came from.
    const sent = filledNewRows;
    try {
      const result = await saveFamilyProductsAction(
        familyId,
        payload,
        sent.map((row) => row.cells),
      );
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
        setNewRows([]);
        setSameAs(new Map());
        setInvalid(new Set());
        const saved = result.count > 0 || result.created.length === 0
          ? t.productsSaved.replace("{n}", formatInt(result.count, locale))
          : "";
        const created = result.created.length > 0
          ? t.productsCreated
              .replace("{n}", formatInt(result.created.length, locale))
              .replace("{parts}", result.created.join(", "))
          : "";
        setNotice({ kind: "ok", text: [saved, created].filter(Boolean).join(" ") });
        // The tree's stock counts; `refreshKey` then reloads these rows too.
        router.refresh();
        return true;
      }
      if (result.kind === "invalid") {
        setInvalid(
          new Set(
            result.cells.map((bad) =>
              "partNumber" in bad ? cellKey(bad.partNumber, bad.cell) : newCellKey(sent[bad.newRow].id, bad.cell),
            ),
          ),
        );
        const first = result.cells.find((bad) => "partNumber" in bad);
        if (first && "partNumber" in first) {
          onInvalid({ partNumber: first.partNumber, index: known.get(first.partNumber)?.index });
        }
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
    newRows,
    nextNewId,
    sameAs,
    invalid,
    known,
    saving,
    notice,
    setNotice,
    changed,
    remember,
    forget,
    change,
    changeNew,
    addCopy,
    removeNew,
    discard,
    save,
  };
}
