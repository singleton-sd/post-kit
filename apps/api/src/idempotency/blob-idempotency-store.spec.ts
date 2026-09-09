import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TenantContext } from '@singleton-sd/post-kit-types';
import { BlobIdempotencyStore, IdempotencyStoreError } from './blob-idempotency-store';

const TENANT: TenantContext = { tenantId: 'inkads', environment: 'development' };

type BlobState = {
  content?: string;
  etag?: string;
};

/**
 * Minimal BlockBlobClient / ContainerClient / BlobServiceClient fakes for
 * conditional-create + If-Match + download + delete behaviour.
 */
function createFakeBlobClient() {
  const blobs = new Map<string, BlobState>();
  let etagCounter = 0;

  const nextEtag = () => {
    etagCounter += 1;
    return `"etag-${etagCounter}"`;
  };

  const client = {
    getContainerClient: () => ({
      getBlockBlobClient: (path: string) => ({
        upload: async (
          body: Buffer,
          _length: number,
          options?: { conditions?: { ifNoneMatch?: string; ifMatch?: string } },
        ) => {
          const existing = blobs.get(path);
          const ifNoneMatch = options?.conditions?.ifNoneMatch;
          const ifMatch = options?.conditions?.ifMatch;

          if (ifNoneMatch === '*' && existing?.content !== undefined) {
            throw Object.assign(new Error('BlobAlreadyExists'), {
              statusCode: 409,
              code: 'BlobAlreadyExists',
            });
          }
          if (ifMatch !== undefined) {
            if (!existing?.content || existing.etag !== ifMatch) {
              throw Object.assign(new Error('ConditionNotMet'), {
                statusCode: 412,
                code: 'ConditionNotMet',
              });
            }
          }

          const etag = nextEtag();
          blobs.set(path, { content: body.toString('utf-8'), etag });
          return { etag };
        },
        download: async () => {
          const existing = blobs.get(path);
          if (!existing?.content) {
            throw Object.assign(new Error('BlobNotFound'), {
              statusCode: 404,
              code: 'BlobNotFound',
            });
          }
          const { Readable } = await import('node:stream');
          return {
            etag: existing.etag,
            readableStreamBody: Readable.from([existing.content]),
          };
        },
        deleteIfExists: async (options?: { conditions?: { ifMatch?: string } }) => {
          const existing = blobs.get(path);
          if (!existing?.content) {
            return { succeeded: false };
          }
          if (options?.conditions?.ifMatch && existing.etag !== options.conditions.ifMatch) {
            throw Object.assign(new Error('ConditionNotMet'), {
              statusCode: 412,
              code: 'ConditionNotMet',
            });
          }
          blobs.delete(path);
          return { succeeded: true };
        },
      }),
    }),
  };

  return { client, blobs };
}

describe('BlobIdempotencyStore', () => {
  it('claims with If-None-Match, completes with If-Match, and replays', async () => {
    const { client } = createFakeBlobClient();
    const store = new BlobIdempotencyStore({
      storageAccount: 'test',
      container: 'idempotency',
      client: client as never,
      ttlMs: 60_000,
    });

    const claimed = await store.begin(TENANT, 'k1');
    assert.equal(claimed.outcome, 'claimed');
    if (claimed.outcome !== 'claimed') return;

    const response = { id: 'corr-1', status: 'sent' as const };
    await store.complete(TENANT, 'k1', response, claimed.claimToken);
    assert.deepEqual(await store.begin(TENANT, 'k1'), { outcome: 'replay', response });
  });

  it('returns in_progress when the blob already exists as in_progress', async () => {
    const { client } = createFakeBlobClient();
    const store = new BlobIdempotencyStore({
      storageAccount: 'test',
      container: 'idempotency',
      client: client as never,
      ttlMs: 60_000,
    });

    const first = await store.begin(TENANT, 'k1');
    assert.equal(first.outcome, 'claimed');
    assert.deepEqual(await store.begin(TENANT, 'k1'), { outcome: 'in_progress' });
  });

  it('releases an in-progress blob with the claim token so a later begin can claim', async () => {
    const { client } = createFakeBlobClient();
    const store = new BlobIdempotencyStore({
      storageAccount: 'test',
      container: 'idempotency',
      client: client as never,
      ttlMs: 60_000,
    });

    const claimed = await store.begin(TENANT, 'k1');
    assert.equal(claimed.outcome, 'claimed');
    if (claimed.outcome !== 'claimed') return;
    await store.release(TENANT, 'k1', claimed.claimToken);
    const again = await store.begin(TENANT, 'k1');
    assert.equal(again.outcome, 'claimed');
  });

  it('rejects stale complete that does not own the claim ETag', async () => {
    const { client } = createFakeBlobClient();
    const store = new BlobIdempotencyStore({
      storageAccount: 'test',
      container: 'idempotency',
      client: client as never,
      ttlMs: 60_000,
    });

    const first = await store.begin(TENANT, 'k1');
    assert.equal(first.outcome, 'claimed');
    if (first.outcome !== 'claimed') return;

    // Simulate reclaim by force-writing a new in_progress via a second store path:
    // release then claim again to rotate the ETag.
    await store.release(TENANT, 'k1', first.claimToken);
    const second = await store.begin(TENANT, 'k1');
    assert.equal(second.outcome, 'claimed');
    if (second.outcome !== 'claimed') return;

    await assert.rejects(
      () => store.complete(TENANT, 'k1', { id: 'stale', status: 'sent' }, first.claimToken),
      (err: unknown) => err instanceof IdempotencyStoreError,
    );

    await store.complete(TENANT, 'k1', { id: 'fresh', status: 'sent' }, second.claimToken);
    assert.deepEqual(await store.begin(TENANT, 'k1'), {
      outcome: 'replay',
      response: { id: 'fresh', status: 'sent' },
    });
  });

  it('ignores stale release that does not own the claim ETag', async () => {
    const { client } = createFakeBlobClient();
    const store = new BlobIdempotencyStore({
      storageAccount: 'test',
      container: 'idempotency',
      client: client as never,
      ttlMs: 60_000,
    });

    const first = await store.begin(TENANT, 'k1');
    assert.equal(first.outcome, 'claimed');
    if (first.outcome !== 'claimed') return;
    await store.release(TENANT, 'k1', first.claimToken);
    const second = await store.begin(TENANT, 'k1');
    assert.equal(second.outcome, 'claimed');
    if (second.outcome !== 'claimed') return;

    await store.release(TENANT, 'k1', first.claimToken);
    assert.deepEqual(await store.begin(TENANT, 'k1'), { outcome: 'in_progress' });
  });

  it('reclaims an expired record with If-Match on the observed ETag', async () => {
    const { client } = createFakeBlobClient();
    const store = new BlobIdempotencyStore({
      storageAccount: 'test',
      container: 'idempotency',
      client: client as never,
      ttlMs: 1,
    });

    const first = await store.begin(TENANT, 'k1');
    assert.equal(first.outcome, 'claimed');
    await new Promise((r) => setTimeout(r, 5));
    const reclaimed = await store.begin(TENANT, 'k1');
    assert.equal(reclaimed.outcome, 'claimed');
    if (reclaimed.outcome !== 'claimed') return;
    assert.notEqual(first.outcome === 'claimed' ? first.claimToken : '', reclaimed.claimToken);
  });
});
