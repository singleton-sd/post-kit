import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TenantContext } from '@singleton-sd/post-kit-types';
import { MemoryIdempotencyStore } from './memory-idempotency-store';

const TENANT_A: TenantContext = { tenantId: 'inkads', environment: 'development' };
const TENANT_B: TenantContext = { tenantId: 'other', environment: 'development' };

describe('MemoryIdempotencyStore', () => {
  it('claims a new key, completes, and replays the stored response', async () => {
    const store = new MemoryIdempotencyStore({ ttlMs: 60_000 });
    const claimed = await store.begin(TENANT_A, 'k1');
    assert.equal(claimed.outcome, 'claimed');
    if (claimed.outcome !== 'claimed') return;

    const response = { id: 'corr-1', status: 'sent' as const };
    await store.complete(TENANT_A, 'k1', response, claimed.claimToken);

    assert.deepEqual(await store.begin(TENANT_A, 'k1'), {
      outcome: 'replay',
      response,
    });
  });

  it('returns in_progress for a concurrent claim', async () => {
    const store = new MemoryIdempotencyStore({ ttlMs: 60_000 });
    const claimed = await store.begin(TENANT_A, 'k1');
    assert.equal(claimed.outcome, 'claimed');
    assert.deepEqual(await store.begin(TENANT_A, 'k1'), { outcome: 'in_progress' });
  });

  it('isolates the same key across tenants', async () => {
    const store = new MemoryIdempotencyStore({ ttlMs: 60_000 });
    const a = await store.begin(TENANT_A, 'shared');
    const b = await store.begin(TENANT_B, 'shared');
    assert.equal(a.outcome, 'claimed');
    assert.equal(b.outcome, 'claimed');
  });

  it('releases an in-progress claim so a retry can claim again', async () => {
    const store = new MemoryIdempotencyStore({ ttlMs: 60_000 });
    const claimed = await store.begin(TENANT_A, 'k1');
    assert.equal(claimed.outcome, 'claimed');
    if (claimed.outcome !== 'claimed') return;
    await store.release(TENANT_A, 'k1', claimed.claimToken);
    const again = await store.begin(TENANT_A, 'k1');
    assert.equal(again.outcome, 'claimed');
  });

  it('rejects stale complete against a rotated claim token', async () => {
    const store = new MemoryIdempotencyStore({ ttlMs: 60_000 });
    const first = await store.begin(TENANT_A, 'k1');
    assert.equal(first.outcome, 'claimed');
    if (first.outcome !== 'claimed') return;
    await store.release(TENANT_A, 'k1', first.claimToken);
    const second = await store.begin(TENANT_A, 'k1');
    assert.equal(second.outcome, 'claimed');
    if (second.outcome !== 'claimed') return;

    await assert.rejects(() =>
      store.complete(TENANT_A, 'k1', { id: 'stale', status: 'sent' }, first.claimToken),
    );
  });

  it('treats expired records as absent', async () => {
    const store = new MemoryIdempotencyStore({ ttlMs: 1 });
    await store.begin(TENANT_A, 'k1');
    await new Promise((r) => setTimeout(r, 5));
    const again = await store.begin(TENANT_A, 'k1');
    assert.equal(again.outcome, 'claimed');
  });
});
