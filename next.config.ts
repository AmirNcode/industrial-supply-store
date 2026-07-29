import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Standalone output exists for the Docker image, which runs `server.js`
   * without node_modules. Vercel and Netlify build Next themselves and do not
   * want it, so it is switched off there rather than left to be ignored.
   */
  output: process.env.VERCEL || process.env.NETLIFY ? undefined : "standalone",
  // Spec tables are huge; keep the server payload lean.
  experimental: {
    optimizePackageImports: ["drizzle-orm"],
  },
  async redirects() {
    return [{ source: "/", destination: "/en", permanent: false }];
  },
};

export default nextConfig;
