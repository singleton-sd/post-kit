import type { SendResponse, TenantContext } from '@singleton-sd/post-kit-types';
import {
  buildIdempotencyRecord,
  isExpired,
  resolveIdempotencyTtlMs,
  type IdempotencyBeginResult,
  type IdempotencyRecord,
  type IdempotencyStore,
} from './idempotency-store';

function storageKey(tenant: TenantContext, key: string): string {
  return `${tenant.tenantId}:${tenant.environment}:${key}`;
}

/**
 * In-memory IdempotencyStore for unit tests.
 * Not safe across Function instances — production uses BlobIdempotencyStore.
 */
export class MemoryIdempotencyStore implements IdempotencyStore {
  private readonly records = new Map<string, IdempotencyRecord>();
  private readonly ttlMs: number;

  constructor(options?: { ttlMs?: number }) {
    this.ttlMs = options?.ttlMs ?? resolveIdempotencyTtlMs();
  }

  async begin(tenant: TenantContext, key: string): Promise<IdempotencyBeginResult> {
    const mapKey = storageKey(tenant, key);
    const existing = this.records.get(mapKey);
    if (existing && !isExpired(existing)) {
      if (existing.status === 'completed' && existing.response) {
        return { outcome: 'replay', response: existing.response };
      }
      return { outcome: 'in_progress' };
    }

    this.records.set(mapKey, buildIdempotencyRecord(tenant, key, 'in_progress', this.ttlMs));
    return { outcome: 'claimed' };
  }

  async complete(tenant: TenantContext, key: string, response: SendResponse): Promise<void> {
    const mapKey = storageKey(tenant, key);
    this.records.set(
      mapKey,
      buildIdempotencyRecord(tenant, key, 'completed', this.ttlMs, response),
    );
  }

  async release(tenant: TenantContext, key: string): Promise<void> {
    const mapKey = storageKey(tenant, key);
    const existing = this.records.get(mapKey);
    if (!existing || existing.status === 'completed') return;
    this.records.delete(mapKey);
  }
}
