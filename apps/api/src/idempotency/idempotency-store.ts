import type { SendResponse, TenantContext } from '@singleton-sd/post-kit-types';

/** Default retention for idempotency records (24 hours). */
export const DEFAULT_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export type IdempotencyStatus = 'in_progress' | 'completed';

/**
 * Persisted record. Never stores recipients, variables, or rendered bodies.
 */
export interface IdempotencyRecord {
  /** Consumer-supplied Idempotency-Key (validated). */
  key: string;
  tenantId: string;
  environment: string;
  status: IdempotencyStatus;
  /** Present when status is `completed`. */
  response?: SendResponse;
  /** ISO-8601 creation time. */
  createdAt: string;
  /** ISO-8601 expiry; expired records are treated as absent. */
  expiresAt: string;
}

/**
 * Opaque concurrency token for the claim (Blob ETag or in-memory generation).
 * Must be passed to `complete` / `release` so a stale claimant cannot overwrite
 * a newer record.
 */
export type IdempotencyClaimToken = string;

export type IdempotencyBeginResult =
  | { outcome: 'claimed'; claimToken: IdempotencyClaimToken }
  | { outcome: 'replay'; response: SendResponse }
  | { outcome: 'in_progress' };

/**
 * Out-of-process idempotency ledger for send.
 *
 * Implementations must scope keys by tenant (and environment) so the same
 * consumer key from two tenants never collides.
 */
export interface IdempotencyStore {
  /**
   * Claim the key for an in-flight send, or return an existing outcome.
   * Expired records are ignored (treated as absent) and may be reclaimed with
   * conditional writes keyed by the observed ETag / generation.
   */
  begin(tenant: TenantContext, key: string): Promise<IdempotencyBeginResult>;

  /**
   * Mark the key completed and store the success response for replays.
   * Must use `claimToken` from `begin` so a stale claimant cannot overwrite a
   * newer claim or completed record.
   */
  complete(
    tenant: TenantContext,
    key: string,
    response: SendResponse,
    claimToken: IdempotencyClaimToken,
  ): Promise<void>;

  /**
   * Drop an in-progress claim so the caller may retry after a failed send.
   * No-op when the record is already completed, absent, or owned by another
   * claim (`claimToken` mismatch).
   */
  release(tenant: TenantContext, key: string, claimToken: IdempotencyClaimToken): Promise<void>;
}

export function resolveIdempotencyTtlMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.IDEMPOTENCY_TTL_MS;
  if (raw === undefined || raw === '') return DEFAULT_IDEMPOTENCY_TTL_MS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_IDEMPOTENCY_TTL_MS;
  return parsed;
}

export function isExpired(record: IdempotencyRecord, nowMs: number = Date.now()): boolean {
  const expiresAt = Date.parse(record.expiresAt);
  if (!Number.isFinite(expiresAt)) return true;
  return nowMs >= expiresAt;
}

export function buildIdempotencyRecord(
  tenant: TenantContext,
  key: string,
  status: IdempotencyStatus,
  ttlMs: number,
  response?: SendResponse,
  nowMs: number = Date.now(),
): IdempotencyRecord {
  return {
    key,
    tenantId: tenant.tenantId,
    environment: tenant.environment,
    status,
    response,
    createdAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + ttlMs).toISOString(),
  };
}
