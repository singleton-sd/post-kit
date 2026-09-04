import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TenantContext } from '@singleton-sd/post-kit-types';
import { BlobIdempotencyStore } from './blob-idempotency-store';

const TENANT: TenantContext = { tenantId: 'inkads', environment: 'development' };

type BlobState = {
  content?: string;
};

/**
 * Minimal BlockBlobClient / ContainerClient / BlobServiceClient fakes for
 * conditional-create + download + delete behaviour.
 */
function createFakeBlobClient() {
  const blobs = new Map<string, BlobState>();

  const client = {
    getContainerClient: () => ({
      getBlockBlobClient: (path: string) => ({
        upload: async (
          body: Buffer,
          _length: number,
          options?: { conditions?: { ifNoneMatch?: string } },
        ) => {
          const existing = blobs.get(path);
          if (options?.conditions?.ifNoneMatch === '*' && existing?.content !== undefined) {
            const err = Object.assign(new Error('BlobAlreadyExists'), {
              statusCode: 409,
              code: 'BlobAlreadyExists',
            });
            throw err;
          }
          blobs.set(path, { content: body.toString('utf-8') });
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
          return { readableStreamBody: Readable.from([existing.content]) };
        },
        deleteIfExists: async () => {
          blobs.delete(path);
          return { succeeded: true };
        },
      }),
    }),
  };

  return { client, blobs };
}

describe('BlobIdempotencyStore', () => {
  it('claims with If-None-Match, completes, and replays without a second claim', async () => {
    const { client } = createFakeBlobClient();
    const store = new BlobIdempotencyStore({
      storageAccount: 'test',
      container: 'idempotency',
      client: client as never,
      ttlMs: 60_000,
    });

    assert.deepEqual(await store.begin(TENANT, 'k1'), { outcome: 'claimed' });
    const response = { id: 'corr-1', status: 'sent' as const };
    await store.complete(TENANT, 'k1', response);
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

    assert.deepEqual(await store.begin(TENANT, 'k1'), { outcome: 'claimed' });
    assert.deepEqual(await store.begin(TENANT, 'k1'), { outcome: 'in_progress' });
  });

  it('releases an in-progress blob so a later begin can claim', async () => {
    const { client } = createFakeBlobClient();
    const store = new BlobIdempotencyStore({
      storageAccount: 'test',
      container: 'idempotency',
      client: client as never,
      ttlMs: 60_000,
    });

    await store.begin(TENANT, 'k1');
    await store.release(TENANT, 'k1');
    assert.deepEqual(await store.begin(TENANT, 'k1'), { outcome: 'claimed' });
  });
});
