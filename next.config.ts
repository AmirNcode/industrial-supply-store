import type { NextConfig } from "next";

/**
 * Our Storage host — exactly the project the build is given, never a
 * wildcard: anyone can create a `*.supabase.co` project. Exposed to the bundle
 * as CATALOG_IMAGE_HOST so `CatalogImage` asks the optimiser only for what it
 * will accept (`optimizableImageUrl`). Without it, every image is served
 * unoptimised rather than through an open proxy.
 */
function storageHost(): string {
  const raw = process.env.SUPABASE_PUBLIC_URL || process.env.SUPABASE_URL;
  try {
    return raw ? new URL(raw).hostname : "";
  } catch {
    return "";
  }
}
const catalogImageHost = storageHost();

const nextConfig: NextConfig = {
  /**
   * Standalone output exists for the Docker image, which runs `server.js`
   * without node_modules. Vercel builds Next itself and does not want it, so
   * it is switched off there rather than left to be ignored.
   */
  output: process.env.VERCEL ? undefined : "standalone",
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
   * Uploads are accepted up to 4 MB and were served byte-for-byte, so a single
   * photograph in an 88px tile could cost 4 MB for about 8 KB of visible
   * pixels. A category page paints ~25 tiles; the arithmetic on a fully
   * populated catalog is what made this worth doing before the pictures
   * arrive rather than after.
   *
   * Only our own Storage, not every host. This used to be `hostname: "**"`
   * on the reasoning that only admins choose image URLs — but the optimiser
   * is a public endpoint: anyone could request
   * `/_next/image?url=https://any-host/…`, and every distinct image and size
   * is a billed transformation (review M-5). Uploaded images live in Storage
   * and are optimised; a supplier URL an admin pastes is served unoptimised by
   * `CatalogImage`, which is the cost of closing the proxy.
   */
  images: {
    remotePatterns: catalogImageHost
      ? [{ protocol: "https", hostname: catalogImageHost, port: "", pathname: "/storage/v1/object/public/**" }]
      : [],
  },
  env: { CATALOG_IMAGE_HOST: catalogImageHost },
  // Spec tables are huge; keep the server payload lean.
  experimental: {
    optimizePackageImports: ["drizzle-orm"],
    /**
     * The 24 MB catalog importer now uploads directly to private Supabase
     * Storage. The remaining large Server Action is catalog artwork: files are
     * capped at 4,000,000 bytes, leaving multipart headroom under both this
     * ceiling and Vercel's 4.5 MB Function payload limit.
     */
    serverActions: { bodySizeLimit: "4.25mb" },
  },
  /** Says nothing about the stack to a scanner; no browser needs it. */
  poweredByHeader: false,
  /**
   * Security headers, set here so Vercel and the Docker server both send them
   * (review finding M-6).
   *
   * Everywhere: no MIME sniffing, a referrer that stops at the origin when
   * leaving the site, and no camera/microphone/location. Framing by other
   * sites is refused everywhere, and on the signed-in and money pages —
   * admin, rep, account, pay, invoice — by any site at all including this
   * one: their confirm dialogs are one click from changing an order, which a
   * page that frames them invisibly can steer (clickjacking). `/pay` and
   * `/invoice` carry a bearer key in the URL, so they send no referrer.
   *
   * Not here: a full Content-Security-Policy. The Enamad seal and Vercel
   * Analytics need allowances that have to be measured first; start it in
   * report-only mode when there is somewhere to send reports.
   */
  async headers() {
    const protectedPage = [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
    ];
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
        ],
      },
      { source: "/:locale/admin/:path*", headers: protectedPage },
      { source: "/:locale/admin", headers: protectedPage },
      { source: "/:locale/rep/:path*", headers: protectedPage },
      { source: "/:locale/rep", headers: protectedPage },
      { source: "/:locale/account/:path*", headers: protectedPage },
      { source: "/:locale/account", headers: protectedPage },
      {
        source: "/:locale/pay/:path*",
        headers: [...protectedPage, { key: "Referrer-Policy", value: "no-referrer" }],
      },
      {
        source: "/:locale/invoice/:path*",
        headers: [...protectedPage, { key: "Referrer-Policy", value: "no-referrer" }],
      },
    ];
  },
  async redirects() {
    return [
      { source: "/", destination: "/fa", permanent: false },
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
