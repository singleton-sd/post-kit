import { isIP } from 'node:net';

/** In-memory sliding-window limiter for anonymous Contact (PoC). */

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSec: number;
}

const MAX_KEYS = 10_000;

export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly maxHits: number,
    private readonly windowMs: number,
  ) {}

  tryConsume(key: string, now = Date.now()): RateLimitResult {
    this.pruneExpired(now);
    const cutoff = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (recent.length >= this.maxHits) {
      const oldest = recent[0] ?? now;
      const retryAfterSec = Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000));
      this.hits.set(key, recent);
      return { allowed: false, retryAfterSec };
    }
    if (!this.hits.has(key) && this.hits.size >= MAX_KEYS) {
      const oldestKey = this.hits.keys().next().value;
      if (oldestKey !== undefined) this.hits.delete(oldestKey);
    }
    recent.push(now);
    this.hits.set(key, recent);
    return { allowed: true, retryAfterSec: 0 };
  }

  /** Test helper — clear all buckets. */
  reset(): void {
    this.hits.clear();
  }

  /** Test helper — number of tracked keys after prune. */
  get size(): number {
    return this.hits.size;
  }

  private pruneExpired(now: number): void {
    const cutoff = now - this.windowMs;
    for (const [tracked, times] of this.hits) {
      const recent = times.filter((t) => t > cutoff);
      if (recent.length === 0) this.hits.delete(tracked);
      else this.hits.set(tracked, recent);
    }
  }
}

const DEFAULT_MAX = 5;
const DEFAULT_WINDOW_MS = 60_000;

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Process-local limiter (resets on cold start / scale-out). A shared store
 * is out of scope for this Y1 PoC; CONTACT_RATE_LIMIT_PER_MIN is best-effort.
 * Constructed lazily so App Configuration can populate env first.
 */
let contactRateLimiter: SlidingWindowRateLimiter | undefined;

export function getContactRateLimiter(): SlidingWindowRateLimiter {
  contactRateLimiter ??= new SlidingWindowRateLimiter(
    parsePositiveInt(process.env.CONTACT_RATE_LIMIT_PER_MIN, DEFAULT_MAX),
    parsePositiveInt(process.env.CONTACT_RATE_LIMIT_WINDOW_MS, DEFAULT_WINDOW_MS),
  );
  return contactRateLimiter;
}

export function resetContactRateLimiter(): void {
  contactRateLimiter = undefined;
}

/**
 * Host from a forwarded hop. App Service often appends `ipv4:port`; IPv6
 * ports use `[addr]:port`. Do not strip the last `:digits` group from bare
 * IPv6. Untrusted `X-Client-IP` / `X-Real-IP` are ignored.
 */
function addressFromForwardedHop(hop: string): string | undefined {
  const trimmed = hop.trim();
  if (!trimmed) return undefined;

  let host = trimmed;
  if (host.startsWith('[')) {
    const close = host.indexOf(']');
    if (close < 2) return undefined;
    host = host.slice(1, close);
  } else if ((host.match(/:/g) ?? []).length === 1) {
    const colon = host.indexOf(':');
    const port = host.slice(colon + 1);
    if (/^\d+$/.test(port)) host = host.slice(0, colon);
  }

  return isIP(host) ? host : undefined;
}

export function clientIpFromHeaders(headers: { get(name: string): string | null }): string {
  const azureClient = addressFromForwardedHop(headers.get('x-azure-clientip') ?? '');
  if (azureClient) return azureClient;

  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const hops = xff
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    // Y1 Consumption / App Service: last hop is the socket peer.
    const last = hops.at(-1);
    const address = last ? addressFromForwardedHop(last) : undefined;
    if (address) return address;
  }

  return 'unknown';
}
