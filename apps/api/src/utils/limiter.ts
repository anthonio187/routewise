/**
 * Serialised "at most one call every N ms" limiter for upstream providers with
 * documented politeness requirements (e.g. Nominatim's 1 request/second).
 */
export class SpacingLimiter {
  private nextSlot = 0;
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly minIntervalMs: number) {}

  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.chain.then(async () => {
      const now = Date.now();
      const wait = Math.max(0, this.nextSlot - now);
      if (wait > 0) await sleep(wait);
      this.nextSlot = Date.now() + this.minIntervalMs;
      return fn();
    });
    // Keep the chain alive even when a call rejects.
    this.chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Fetch with a hard timeout and a descriptive User-Agent. */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 8000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
