import { routes, type VercelConfig } from "@vercel/config/v1";

/**
 * Vercel project configuration.
 *
 * Note this file has no effect on the Docker path — `docker compose` still
 * builds from the Dockerfile. Vercel ignores the Dockerfile entirely and builds
 * Next.js natively, so the two deployment routes share only the source.
 */
export const config: VercelConfig = {
  framework: "nextjs",

  /**
   * Put the functions next to the database.
   *
   * Almost every request in this app makes several Postgres round trips — the
   * family page alone runs the product query, the count, the facet aggregation
   * and the category lookup. Cross-continent latency multiplies across all of
   * them, so co-locating the functions with the database is worth more here
   * than picking a region close to the buyer.
   *
   * `fra1` (Frankfurt) assumes a Neon project in `aws-eu-central-1`, which is
   * the closest sensible region for an Iranian market. CHANGE THIS to match
   * whichever region the database actually lives in — a mismatch is the single
   * easiest way to make the deployed site feel slower than localhost.
   *
   * Hobby plans are limited to one region; Pro and Enterprise can list several.
   */
  regions: ["fra1"],

  headers: [
    /**
     * The bundled font subsets are content-stable: their filenames never change
     * because the faces never change. Without this they are served
     * `max-age=0, must-revalidate` like everything else in `public/`, which
     * costs a revalidation round trip for ~60KB on every single page view.
     *
     * If a font file is ever replaced, change its filename too — an immutable
     * response cannot be invalidated.
     */
    routes.cacheControl("/fonts/(.*)", {
      public: true,
      maxAge: "1 year",
      immutable: true,
    }),
  ],
};
