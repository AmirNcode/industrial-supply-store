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
  // Spec tables are huge; keep the server payload lean.
  experimental: {
    optimizePackageImports: ["drizzle-orm"],
  },
  async redirects() {
    return [{ source: "/", destination: "/en", permanent: false }];
  },
};

export default nextConfig;
