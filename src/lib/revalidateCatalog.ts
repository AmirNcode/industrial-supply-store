import "server-only";
import { revalidatePath } from "next/cache";

/**
 * Marks stale the only pages this site caches: the home page and the category
 * pages (`revalidate = 3600`). Everything else — family, list, search, cart,
 * account, admin — renders per request and has nothing to purge.
 *
 * Use this instead of `revalidatePath("/", "layout")`, which also throws away
 * the client router cache and every route's data, on anything an admin
 * presses (ARCHITECTURE.md, the 2026-08-15 incident; review finding M-7).
 * Settings that only priced pages read (exchange rate, currency display) need
 * no purge at all: no cached page shows a price.
 */
export function revalidateCatalogPages(): void {
  revalidatePath("/[locale]", "page");
  revalidatePath("/[locale]/c/[...slug]", "page");
}
