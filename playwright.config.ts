import { defineConfig, devices } from "@playwright/test";

/**
 * The suite creates orders, customers, reps and settings. It must never run
 * against a server on the live database (review finding M-12): refuse any
 * DATABASE_URL that is not this machine. The live credentials live in
 * `.env.remote`, which `next start` does not load.
 */
const databaseHost = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).hostname : "localhost";
if (databaseHost !== "localhost" && databaseHost !== "127.0.0.1") {
  throw new Error(`Refusing to run e2e against a non-local database (${databaseHost}).`);
}

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3100);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "test-results",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [["line"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: `npm run start -- --hostname 127.0.0.1 --port ${port}`,
    // A production server needs to be told which header carries the client
    // address (src/lib/rateLimit.ts). Locally Next fills x-forwarded-for.
    env: { TRUSTED_PROXY_HEADER: process.env.TRUSTED_PROXY_HEADER ?? "x-forwarded-for" },
    url: `${baseURL}/en`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
    },
  ],
});
