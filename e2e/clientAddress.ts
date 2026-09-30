/**
 * The header the test server reads the client address from. Specs set a
 * different address per test so their admin sign-ins land in separate
 * rate-limit buckets — the suite signs in far more than 8 times in 15 minutes.
 * It used to be `x-vercel-forwarded-for`, which any client could set on a
 * non-Vercel server (review finding H-5); now it is whichever header the
 * server was told to trust (playwright.config.ts, ci.yml).
 */
export const CLIENT_ADDRESS_HEADER = process.env.TRUSTED_PROXY_HEADER ?? "x-forwarded-for";
