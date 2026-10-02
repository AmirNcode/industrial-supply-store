"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { FamilyProductsResponse } from "@/app/api/admin/family/[id]/products/route";
import {
  PRODUCT_PAGE_SIZE,
  type ProductRecord,
  type ProductTableDef,
} from "@/lib/productTable";
import type { Locale } from "@/lib/i18n";
import { useProductDrafts, type ProductTableHandle } from "../productDrafts";

type Status = "loading" | "ready" | "failed";

/** How long the search waits for the person to stop typing. */
const SEARCH_DELAY_MS = 300;

async function fetchPage(
  familyId: number,
  page: number,
  query: string,
  signal?: AbortSignal,
): Promise<FamilyProductsResponse> {
  const params = new URLSearchParams({ page: String(page) });
  if (query) params.set("q", query);
  const response = await fetch(`/api/admin/family/${familyId}/products?${params}`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error(`products ${response.status}`);
  return response.json();
}

/**
 * A family's products as the phone shows them: a list that grows with
 * Show more rather than a pager, and a part-number search that asks the
 * server, so it finds rows that have not been loaded yet.
 *
 * The edits are the desktop table's own (`useProductDrafts`): the same drafts,
 * the same checks and the same Save, and the same handle for the page's guard.
 * They live as long as the family's screens do — its list, a product, its
 * details — and go when the person moves to another node, after the guard.
 */
export function useFamilyProducts({
  familyId,
  locale,
  refreshKey,
  onPendingChange,
  handleRef,
}: {
  familyId: number;
  locale: Locale;
  /** Changes whenever the page's data is refreshed, e.g. after an import. */
  refreshKey: unknown;
  onPendingChange: (changedProducts: number) => void;
  handleRef: RefObject<ProductTableHandle | null>;
}) {
  const [defs, setDefs] = useState<ProductTableDef[]>([]);
  const [rows, setRows] = useState<ProductRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(0);
  const [status, setStatus] = useState<Status>("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);
  /** How many pages a reload fetches: what Show more had reached. */
  const wanted = useRef(1);

  const drafts = useProductDrafts({
    familyId,
    locale,
    onPendingChange,
    onSaved: (fresh) =>
      setRows((previous) => previous.map((product) => fresh.get(product.partNumber) ?? product)),
    onInvalid: ({ partNumber, index }) => {
      setScrollTarget(partNumber);
      // A refused row that is not on screen: load the list down to it.
      if (!rows.some((row) => row.partNumber === partNumber) && index !== undefined) {
        setInput("");
        setQuery("");
        wanted.current = Math.floor(index / PRODUCT_PAGE_SIZE) + 1;
        setReloadToken((token) => token + 1);
      }
    },
    // Fresh rows under the same edits: the person checks, then saves again.
    onStale: () => setReloadToken((token) => token + 1),
  });
  const remember = drafts.remember;

  useEffect(() => {
    const trimmed = input.trim();
    if (trimmed === query) return;
    const timer = window.setTimeout(() => {
      wanted.current = 1;
      setQuery(trimmed);
    }, SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [input, query]);

  useEffect(() => {
    const controller = new AbortController();
    const count = Math.max(1, wanted.current);
    Promise.all(
      Array.from({ length: count }, (_, page) =>
        fetchPage(familyId, page, query, controller.signal),
      ),
    )
      .then((bodies) => {
        setDefs(bodies[0].defs);
        setTotal(bodies[0].total);
        setRows(dedupe(bodies.flatMap((body) => body.products)));
        setPages(count);
        // A search result's place in the full list is unknown.
        for (const body of bodies) {
          remember(body.products, query ? null : body.page * PRODUCT_PAGE_SIZE);
        }
        setStatus("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus("failed");
      });
    return () => controller.abort();
    // `remember` only calls a state setter; listing it would refetch on
    // every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyId, refreshKey, query, reloadToken]);

  async function showMore() {
    if (loadingMore || rows.length >= total) return;
    setLoadingMore(true);
    try {
      const body = await fetchPage(familyId, pages, query);
      setRows((previous) => dedupe([...previous, ...body.products]));
      setTotal(body.total);
      setPages(pages + 1);
      wanted.current = pages + 1;
      remember(body.products, query ? null : body.page * PRODUCT_PAGE_SIZE);
    } catch {
      setStatus("failed");
    } finally {
      setLoadingMore(false);
    }
  }

  function retry() {
    setStatus("loading");
    setReloadToken((token) => token + 1);
  }

  /**
   * A product opened by its address — a reload, or Back into it — may not be
   * among the rows loaded. Looked up by an exact part-number search.
   */
  const [lookup, setLookup] = useState<{ part: string; state: "loading" | "missing" } | null>(null);
  function ensureProduct(partNumber: string) {
    if (drafts.known.has(partNumber) || lookup?.part === partNumber) return;
    setLookup({ part: partNumber, state: "loading" });
    fetchPage(familyId, 0, partNumber)
      .then((body) => {
        const found = body.products.filter((product) => product.partNumber === partNumber);
        if (defs.length === 0) setDefs(body.defs);
        remember(found, null);
        setLookup(found.length > 0 ? null : { part: partNumber, state: "missing" });
      })
      .catch(() => setLookup({ part: partNumber, state: "missing" }));
  }

  // The page's guard and pending bar save and discard through this.
  useEffect(() => {
    handleRef.current = { save: drafts.save, discard: drafts.discard };
  });
  useEffect(() => () => {
    handleRef.current = null;
  }, [handleRef]);

  return {
    ...drafts,
    defs,
    rows,
    total,
    status,
    loadingMore,
    input,
    setInput,
    query,
    searching: input.trim() !== query,
    showMore,
    retry,
    ensureProduct,
    lookup,
    scrollTarget,
    clearScrollTarget: () => setScrollTarget(null),
  };
}

function dedupe(products: ProductRecord[]): ProductRecord[] {
  const seen = new Set<string>();
  return products.filter((product) => {
    if (seen.has(product.partNumber)) return false;
    seen.add(product.partNumber);
    return true;
  });
}
