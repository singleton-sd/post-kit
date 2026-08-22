/** In-memory sliding-window limiter for anonymous Contact (PoC). */

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSec: number;
}

export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly maxHits: number,
    private readonly windowMs: number,
  ) {}

  tryConsume(key: string, now = Date.now()): RateLimitResult {
    const cutoff = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (recent.length >= this.maxHits) {
      const oldest = recent[0] ?? now;
      const retryAfterSec = Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000));
      this.hits.set(key, recent);
      return { allowed: false, retryAfterSec };
    }
    recent.push(now);
    this.hits.set(key, recent);
    return { allowed: true, retryAfterSec: 0 };
  }

  /** Test helper — clear all buckets. */
  reset(): void {
    this.hits.clear();
  }
}

const DEFAULT_MAX = 5;
const DEFAULT_WINDOW_MS = 60_000;

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Shared limiter for the Function process (resets on cold start / scale-out). */
export const contactRateLimiter = new SlidingWindowRateLimiter(
  parsePositiveInt(process.env.CONTACT_RATE_LIMIT_PER_MIN, DEFAULT_MAX),
  parsePositiveInt(process.env.CONTACT_RATE_LIMIT_WINDOW_MS, DEFAULT_WINDOW_MS),
);

export function clientIpFromHeaders(headers: { get(name: string): string | null }): string {
  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return (
    headers.get('x-client-ip')?.trim() ||
    headers.get('x-real-ip')?.trim() ||
    headers.get('x-azure-clientip')?.trim() ||
    'unknown'
  );
}
