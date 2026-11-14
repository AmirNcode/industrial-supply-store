/**
 * A request limit kept in this server instance's memory, for reads that are
 * cheap enough that recording each one in the database costs more than it
 * protects (review R-27): a search suggestion was one write before three
 * reads, on every burst of keystrokes.
 *
 * It is weaker than the database limiter on purpose. Each server instance
 * counts on its own, and a restart forgets — acceptable for a public read
 * that crawlers are barred from, never for sign-in, checkout or uploads,
 * which keep the shared, durable limiter in `rateLimit.ts`.
 */
type Window = { count: number; resetAt: number };

const MAX_KEYS = 5_000;

export function createMemoryRateLimit(policy: { limit: number; windowSeconds: number }) {
  const windows = new Map<string, Window>();

  return function allow(key: string, nowMs = Date.now()): { allowed: boolean; retryAfter: number } {
    let window = windows.get(key);
    if (!window || window.resetAt <= nowMs) {
      // Bounded: drop lapsed windows first, and everything if that is not enough.
      if (windows.size >= MAX_KEYS) {
        for (const [k, w] of windows) if (w.resetAt <= nowMs) windows.delete(k);
        if (windows.size >= MAX_KEYS) windows.clear();
      }
      window = { count: 0, resetAt: nowMs + policy.windowSeconds * 1000 };
      windows.set(key, window);
    }
    window.count += 1;
    return {
      allowed: window.count <= policy.limit,
      retryAfter: Math.max(1, Math.ceil((window.resetAt - nowMs) / 1000)),
    };
  };
}
