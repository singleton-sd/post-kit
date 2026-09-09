import type { SendResponse, TenantContext } from '@singleton-sd/post-kit-types';
import {
  buildIdempotencyRecord,
  isExpired,
  resolveIdempotencyTtlMs,
  type IdempotencyBeginResult,
  type IdempotencyClaimToken,
  type IdempotencyRecord,
  type IdempotencyStore,
} from './idempotency-store';

function storageKey(tenant: TenantContext, key: string): string {
  return `${tenant.tenantId}:${tenant.environment}:${key}`;
}

type MemoryEntry = {
  record: IdempotencyRecord;
  /** Monotonic generation string used as the claim token. */
  generation: string;
};

/**
 * In-memory IdempotencyStore for unit tests.
 * Not safe across Function instances — production uses BlobIdempotencyStore.
 */
export class MemoryIdempotencyStore implements IdempotencyStore {
  private readonly records = new Map<string, MemoryEntry>();
  private readonly ttlMs: number;
  private generationCounter = 0;

  constructor(options?: { ttlMs?: number }) {
    this.ttlMs = options?.ttlMs ?? resolveIdempotencyTtlMs();
  }

  async begin(tenant: TenantContext, key: string): Promise<IdempotencyBeginResult> {
    const mapKey = storageKey(tenant, key);
    const existing = this.records.get(mapKey);
    if (existing && !isExpired(existing.record)) {
      if (existing.record.status === 'completed' && existing.record.response) {
        return { outcome: 'replay', response: existing.record.response };
      }
      return { outcome: 'in_progress' };
    }

    const generation = this.nextGeneration();
    this.records.set(mapKey, {
      record: buildIdempotencyRecord(tenant, key, 'in_progress', this.ttlMs),
      generation,
    });
    return { outcome: 'claimed', claimToken: generation };
  }

  async complete(
    tenant: TenantContext,
    key: string,
    response: SendResponse,
    claimToken: IdempotencyClaimToken,
  ): Promise<void> {
    const mapKey = storageKey(tenant, key);
    const existing = this.records.get(mapKey);
    if (!existing || existing.generation !== claimToken) {
      throw new Error('Lost idempotency claim (stale complete).');
    }
    this.records.set(mapKey, {
      record: buildIdempotencyRecord(tenant, key, 'completed', this.ttlMs, response),
      generation: existing.generation,
    });
  }

  async release(
    tenant: TenantContext,
    key: string,
    claimToken: IdempotencyClaimToken,
  ): Promise<void> {
    const mapKey = storageKey(tenant, key);
    const existing = this.records.get(mapKey);
    if (!existing || existing.generation !== claimToken) return;
    if (existing.record.status === 'completed') return;
    this.records.delete(mapKey);
  }

  private nextGeneration(): string {
    this.generationCounter += 1;
    return `mem-${this.generationCounter}`;
  }
}
