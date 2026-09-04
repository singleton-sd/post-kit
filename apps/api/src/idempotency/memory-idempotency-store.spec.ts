import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TenantContext } from '@singleton-sd/post-kit-types';
import { MemoryIdempotencyStore } from './memory-idempotency-store';

const TENANT_A: TenantContext = { tenantId: 'inkads', environment: 'development' };
const TENANT_B: TenantContext = { tenantId: 'other', environment: 'development' };

describe('MemoryIdempotencyStore', () => {
  it('claims a new key, completes, and replays the stored response', async () => {
    const store = new MemoryIdempotencyStore({ ttlMs: 60_000 });
    assert.deepEqual(await store.begin(TENANT_A, 'k1'), { outcome: 'claimed' });

    const response = { id: 'corr-1', status: 'sent' as const };
    await store.complete(TENANT_A, 'k1', response);

    assert.deepEqual(await store.begin(TENANT_A, 'k1'), {
      outcome: 'replay',
      response,
    });
  });

  it('returns in_progress for a concurrent claim', async () => {
    const store = new MemoryIdempotencyStore({ ttlMs: 60_000 });
    assert.deepEqual(await store.begin(TENANT_A, 'k1'), { outcome: 'claimed' });
    assert.deepEqual(await store.begin(TENANT_A, 'k1'), { outcome: 'in_progress' });
  });

  it('isolates the same key across tenants', async () => {
    const store = new MemoryIdempotencyStore({ ttlMs: 60_000 });
    assert.deepEqual(await store.begin(TENANT_A, 'shared'), { outcome: 'claimed' });
    assert.deepEqual(await store.begin(TENANT_B, 'shared'), { outcome: 'claimed' });
  });

  it('releases an in-progress claim so a retry can claim again', async () => {
    const store = new MemoryIdempotencyStore({ ttlMs: 60_000 });
    await store.begin(TENANT_A, 'k1');
    await store.release(TENANT_A, 'k1');
    assert.deepEqual(await store.begin(TENANT_A, 'k1'), { outcome: 'claimed' });
  });

  it('treats expired records as absent', async () => {
    const store = new MemoryIdempotencyStore({ ttlMs: 1 });
    await store.begin(TENANT_A, 'k1');
    await new Promise((r) => setTimeout(r, 5));
    assert.deepEqual(await store.begin(TENANT_A, 'k1'), { outcome: 'claimed' });
  });
});
