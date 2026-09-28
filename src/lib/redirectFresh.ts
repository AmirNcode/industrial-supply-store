import "server-only";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";

/**
 * Redirect back to the page a form was posted from, with that page re-read.
 *
 * For a Server Action whose redirect differs from the URL on screen only by
 * its #fragment — a follow-up button returning to `/customers/<id>#follow-up`
 * from `/customers/<id>` — the router treats the redirect as an in-page jump:
 * it scrolls and keeps the page it already holds, so the change does not
 * appear until a reload. (A redirect to the identical URL, or to a different
 * query string, does re-render — checked on Next 16 with a second note and a
 * second password reset in a row — so plain `redirect` is right everywhere
 * else.) `refresh()` makes the router re-fetch the page's dynamic data. Unlike
 * revalidatePath it purges nothing cached on the server, so it cannot start
 * the whole-site rebuild behind the 2026-08-15 hang.
 */
export function redirectFresh(url: string): never {
  refresh();
  redirect(url);
}
