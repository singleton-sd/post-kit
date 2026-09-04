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

export type IdempotencyBeginResult =
  | { outcome: 'claimed' }
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
   * Expired records are ignored (treated as absent).
   */
  begin(tenant: TenantContext, key: string): Promise<IdempotencyBeginResult>;

  /** Mark the key completed and store the success response for replays. */
  complete(tenant: TenantContext, key: string, response: SendResponse): Promise<void>;

  /**
   * Drop an in-progress claim so the caller may retry after a failed send.
   * No-op when the record is already completed or absent.
   */
  release(tenant: TenantContext, key: string): Promise<void>;
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
