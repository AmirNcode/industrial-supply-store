import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Needed so the Docker image can run without node_modules.
  output: "standalone",
  // Spec tables are huge; keep the server payload lean.
  experimental: {
    optimizePackageImports: ["drizzle-orm"],
  },
  async redirects() {
    return [{ source: "/", destination: "/en", permanent: false }];
  },
};

export default nextConfig;
