import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Standalone output exists for the Docker image, which runs `server.js`
   * without node_modules. Vercel and Netlify build Next themselves and do not
   * want it, so it is switched off there rather than left to be ignored.
   */
  output: process.env.VERCEL || process.env.NETLIFY ? undefined : "standalone",
  /**
   * Testing on a real phone means hitting the dev server at the machine's LAN
   * address, and `next dev` blocks `/_next/*` and the HMR socket for every
   * origin except localhost. The page still server-renders, so it looks fine —
   * but no client bundle executes, nothing hydrates, and every onClick on the
   * site is silently dead: the mobile drawer, the filter sheet, add-to-cart.
   *
   * The subnet wildcard is there because the host's address comes from DHCP and
   * the exact one changes; the literal is the current lease.
   *
   * Development only. `next build` ignores this.
   */
  allowedDevOrigins: ["192.168.2.*", "192.168.2.48"],
  /**
   * Raised from the default 60.
   *
   * Vercel builds this project in `iad1` while the database is in
   * `eu-central-1`, so every query during prerendering is a transatlantic round
   * trip and a page that renders in milliseconds locally can take tens of
   * seconds here. Pages were already brushing the 60-second ceiling before
   * anything was added to the build — and a page that trips it is *retried*,
   * which spends the same latency again and pushes the next page closer to its
   * own limit. The 2026-08-16 deploy failed that way, ending in the pooler
   * dropping a connection mid-render.
   *
   * This buys headroom; it does not make the build fast. The real lever is
   * prerendering fewer pages, which is why the category route generates none.
   */
  staticPageGenerationTimeout: 120,
  /**
   * Catalog artwork goes through the image optimiser.
   *
   * Every picture in this catalog is painted into a 34–64px tile, and the
   * sources are supplier files: the one real external image is a 650×975 WebP,
   * 48.8 KB, rendered at 34px — roughly forty times the pixels the tile uses.
   * Uploads are accepted up to 5 MB and were served byte-for-byte, so a single
   * photograph in an 88px tile could cost 5 MB for about 8 KB of visible
   * pixels. A category page paints ~25 tiles; the arithmetic on a fully
   * populated catalog is what made this worth doing before the pictures
   * arrive rather than after.
   *
   * `hostname: "**"` rather than a list, and that is a real trade. An
   * administrator can paste any supplier URL — that is the feature — so the
   * host genuinely cannot be enumerated ahead of time, and the alternative is
   * that pasted images stay unoptimised, which is the case that exists in the
   * catalog today. The cost is that the optimiser will fetch any HTTPS URL an
   * admin enters, and each distinct image and size is a transformation the
   * platform bills for. Both are bounded by who can reach /admin.
   *
   * HTTPS only. `normalizeCatalogImageUrl` still accepts http, and
   * `CatalogImage` serves those unoptimised rather than failing the render.
   */
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
  // Spec tables are huge; keep the server payload lean.
  experimental: {
    optimizePackageImports: ["drizzle-orm"],
    /**
     * Sized for the catalog importer, which is the largest thing posted here:
     * a 24 MB CSV (`MAX_BYTES` in the products actions) travels as a form
     * field, and the analyze and confirm posts each carry the whole thing.
     * Catalog images, the other upload, are capped at 5 MB apiece.
     */
    serverActions: { bodySizeLimit: "32mb" },
  },
  async redirects() {
    return [
      { source: "/", destination: "/en", permanent: false },
      /**
       * The SKU list used to be `?view=list` on the category page. Reading that
       * param made the category page itself uncacheable, so the list moved to
       * its own segment; this keeps links shared or bookmarked before the move
       * landing on the view they asked for.
       */
      {
        source: "/:locale/c/:slug*",
        has: [{ type: "query", key: "view", value: "list" }],
        destination: "/:locale/l/:slug*",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
