import { createHash } from 'node:crypto';
import type { BlobServiceClient, BlockBlobClient } from '@azure/storage-blob';
import { BlobServiceClient as AzureBlobServiceClient } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';
import type { SendResponse, TenantContext } from '@singleton-sd/post-kit-types';
import { PostKitErrorCode } from '@singleton-sd/post-kit-types';
import { ensureAppConfiguration } from '../config/app-configuration';
import {
  buildIdempotencyRecord,
  isExpired,
  resolveIdempotencyTtlMs,
  type IdempotencyBeginResult,
  type IdempotencyClaimToken,
  type IdempotencyRecord,
  type IdempotencyStore,
} from './idempotency-store';

/**
 * Error thrown when the idempotency ledger cannot be read or written.
 */
export class IdempotencyStoreError extends Error {
  readonly code: PostKitErrorCode;

  constructor(message: string, code: PostKitErrorCode = PostKitErrorCode.STORAGE_FAILURE) {
    super(message);
    this.name = 'IdempotencyStoreError';
    this.code = code;
  }
}

export interface BlobIdempotencyStoreOptions {
  storageAccount: string;
  container: string;
  credential?: InstanceType<typeof DefaultAzureCredential>;
  client?: BlobServiceClient;
  ttlMs?: number;
}

type StoredSnapshot = {
  record: IdempotencyRecord;
  etag: string;
};

/**
 * Azure Blob Storage idempotency ledger.
 *
 * Blob path:
 *   tenants/{tenantId}/{environment}/idempotency/{sha256(key)}.json
 *
 * Why Blob (not Table): the API already depends on `@azure/storage-blob` and
 * `DefaultAzureCredential` for templates; a small JSON blob per key needs no
 * new package, supports conditional create (`If-None-Match: *`) for claim
 * races, and stores only the non-sensitive fields required for replay.
 *
 * Claim concurrency uses the blob ETag returned from the claim upload. Completing
 * or releasing without that ETag (`If-Match`) fails so a stale claimant cannot
 * overwrite a newer claim or completed record. Expired reclaim uses the observed
 * read ETag (or `If-None-Match: *` when absent).
 *
 * TTL is enforced on read (expired blobs are ignored and may be reclaimed).
 * Soft delete / lifecycle rules can reclaim bytes; see docs/architecture/send-idempotency.md.
 */
export class BlobIdempotencyStore implements IdempotencyStore {
  private readonly client: BlobServiceClient;
  private readonly container: string;
  private readonly ttlMs: number;

  constructor(options: BlobIdempotencyStoreOptions) {
    this.container = options.container;
    this.ttlMs = options.ttlMs ?? resolveIdempotencyTtlMs();

    if (options.client) {
      this.client = options.client;
    } else {
      const credential = options.credential ?? new DefaultAzureCredential();
      const url = `https://${options.storageAccount}.blob.core.windows.net`;
      this.client = new AzureBlobServiceClient(url, credential);
    }
  }

  static async fromEnv(
    dependencies?: Parameters<typeof ensureAppConfiguration>[0],
  ): Promise<BlobIdempotencyStore> {
    await ensureAppConfiguration(dependencies);

    const storageAccount =
      process.env['IDEMPOTENCY_STORAGE_ACCOUNT'] ?? process.env['TEMPLATE_STORAGE_ACCOUNT'];
    const container = process.env['IDEMPOTENCY_STORAGE_CONTAINER'] ?? 'idempotency';

    if (!storageAccount) {
      throw new Error(
        'Missing required environment variable: IDEMPOTENCY_STORAGE_ACCOUNT (or TEMPLATE_STORAGE_ACCOUNT)',
      );
    }

    return new BlobIdempotencyStore({
      storageAccount,
      container,
      ttlMs: resolveIdempotencyTtlMs(),
    });
  }

  async begin(tenant: TenantContext, key: string): Promise<IdempotencyBeginResult> {
    const containerClient = this.client.getContainerClient(this.container);
    const blob = containerClient.getBlockBlobClient(blobPath(tenant, key));
    const record = buildIdempotencyRecord(tenant, key, 'in_progress', this.ttlMs);
    const body = Buffer.from(JSON.stringify(record), 'utf-8');

    try {
      const uploaded = await blob.upload(body, body.length, {
        blobHTTPHeaders: { blobContentType: 'application/json' },
        conditions: { ifNoneMatch: '*' },
      });
      return { outcome: 'claimed', claimToken: requireEtag(uploaded.etag) };
    } catch (err: unknown) {
      if (!isConflictError(err)) {
        throw new IdempotencyStoreError(
          'Failed to claim idempotency key in storage.',
          PostKitErrorCode.STORAGE_FAILURE,
        );
      }
    }

    return this.resolveAfterConflict(blob, tenant, key, body);
  }

  async complete(
    tenant: TenantContext,
    key: string,
    response: SendResponse,
    claimToken: IdempotencyClaimToken,
  ): Promise<void> {
    const containerClient = this.client.getContainerClient(this.container);
    const blob = containerClient.getBlockBlobClient(blobPath(tenant, key));
    const record = buildIdempotencyRecord(tenant, key, 'completed', this.ttlMs, response);
    const body = Buffer.from(JSON.stringify(record), 'utf-8');
    try {
      await blob.upload(body, body.length, {
        blobHTTPHeaders: { blobContentType: 'application/json' },
        conditions: { ifMatch: claimToken },
      });
    } catch (err: unknown) {
      if (isPreconditionError(err) || isConflictError(err)) {
        const current = await this.readSnapshot(blob);
        if (
          current?.record.status === 'completed' &&
          current.record.response &&
          current.record.response.id === response.id
        ) {
          // Another writer finished with the same response — treat as success.
          return;
        }
        throw new IdempotencyStoreError(
          'Lost idempotency claim while completing; record was modified by another request.',
          PostKitErrorCode.STORAGE_FAILURE,
        );
      }
      throw new IdempotencyStoreError(
        'Failed to persist completed idempotency record.',
        PostKitErrorCode.STORAGE_FAILURE,
      );
    }
  }

  async release(
    tenant: TenantContext,
    key: string,
    claimToken: IdempotencyClaimToken,
  ): Promise<void> {
    const containerClient = this.client.getContainerClient(this.container);
    const blob = containerClient.getBlockBlobClient(blobPath(tenant, key));
    try {
      const existing = await this.readSnapshot(blob);
      if (!existing || existing.record.status === 'completed') return;
      await blob.deleteIfExists({
        conditions: { ifMatch: claimToken },
      });
    } catch (err: unknown) {
      if (isPreconditionError(err) || isConflictError(err) || isNotFoundError(err)) {
        // Another claimant owns the blob now — leave it alone.
        return;
      }
      throw new IdempotencyStoreError(
        'Failed to release idempotency claim in storage.',
        PostKitErrorCode.STORAGE_FAILURE,
      );
    }
  }

  private async resolveAfterConflict(
    blob: BlockBlobClient,
    tenant: TenantContext,
    key: string,
    claimBody: Buffer,
  ): Promise<IdempotencyBeginResult> {
    const existing = await this.readSnapshot(blob);
    if (!existing || isExpired(existing.record)) {
      try {
        const uploaded = await blob.upload(claimBody, claimBody.length, {
          blobHTTPHeaders: { blobContentType: 'application/json' },
          conditions: existing ? { ifMatch: existing.etag } : { ifNoneMatch: '*' },
        });
        return { outcome: 'claimed', claimToken: requireEtag(uploaded.etag) };
      } catch (err: unknown) {
        if (isPreconditionError(err) || isConflictError(err)) {
          // Lost the reclaim race — re-evaluate the current record once.
          const raced = await this.readSnapshot(blob);
          if (raced && !isExpired(raced.record)) {
            if (raced.record.status === 'completed' && raced.record.response) {
              return { outcome: 'replay', response: raced.record.response };
            }
            return { outcome: 'in_progress' };
          }
        }
        throw new IdempotencyStoreError(
          'Failed to reclaim expired idempotency key in storage.',
          PostKitErrorCode.STORAGE_FAILURE,
        );
      }
    }

    if (existing.record.status === 'completed' && existing.record.response) {
      return { outcome: 'replay', response: existing.record.response };
    }
    return { outcome: 'in_progress' };
  }

  private async readSnapshot(blob: BlockBlobClient): Promise<StoredSnapshot | undefined> {
    try {
      const download = await blob.download();
      const text = await streamToString(download.readableStreamBody);
      const record = parseRecord(text);
      if (!record) return undefined;
      const etag = download.etag;
      if (!etag) {
        throw new IdempotencyStoreError(
          'Idempotency blob download omitted ETag.',
          PostKitErrorCode.STORAGE_FAILURE,
        );
      }
      return { record, etag };
    } catch (err: unknown) {
      if (isNotFoundError(err)) return undefined;
      if (err instanceof IdempotencyStoreError) throw err;
      throw new IdempotencyStoreError(
        'Failed to read idempotency record from storage.',
        PostKitErrorCode.STORAGE_FAILURE,
      );
    }
  }
}

function blobPath(tenant: TenantContext, key: string): string {
  const digest = createHash('sha256').update(key, 'utf8').digest('hex');
  return `tenants/${tenant.tenantId}/${tenant.environment}/idempotency/${digest}.json`;
}

function requireEtag(etag: string | undefined): string {
  if (!etag) {
    throw new IdempotencyStoreError(
      'Idempotency blob upload omitted ETag.',
      PostKitErrorCode.STORAGE_FAILURE,
    );
  }
  return etag;
}

function parseRecord(json: string): IdempotencyRecord | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj['key'] !== 'string') return undefined;
  if (typeof obj['tenantId'] !== 'string') return undefined;
  if (typeof obj['environment'] !== 'string') return undefined;
  if (obj['status'] !== 'in_progress' && obj['status'] !== 'completed') return undefined;
  if (typeof obj['createdAt'] !== 'string') return undefined;
  if (typeof obj['expiresAt'] !== 'string') return undefined;

  let response: SendResponse | undefined;
  if (obj['response'] !== undefined) {
    const r = obj['response'];
    if (typeof r !== 'object' || r === null) return undefined;
    const resp = r as Record<string, unknown>;
    if (typeof resp['id'] !== 'string' || resp['status'] !== 'sent') return undefined;
    response = { id: resp['id'], status: 'sent' };
  }

  return {
    key: obj['key'],
    tenantId: obj['tenantId'],
    environment: obj['environment'],
    status: obj['status'],
    response,
    createdAt: obj['createdAt'],
    expiresAt: obj['expiresAt'],
  };
}

function isConflictError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as Record<string, unknown>;
  return (
    e['statusCode'] === 409 ||
    e['code'] === 'BlobAlreadyExists' ||
    e['errorCode'] === 'BlobAlreadyExists'
  );
}

function isPreconditionError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as Record<string, unknown>;
  return (
    e['statusCode'] === 412 ||
    e['code'] === 'ConditionNotMet' ||
    e['errorCode'] === 'ConditionNotMet' ||
    e['code'] === 'LeaseIdMismatchWithLeaseOperation'
  );
}

function isNotFoundError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as Record<string, unknown>;
  return (
    e['statusCode'] === 404 || e['code'] === 'BlobNotFound' || e['errorCode'] === 'BlobNotFound'
  );
}

async function streamToString(stream: NodeJS.ReadableStream | undefined | null): Promise<string> {
  if (!stream) return '';
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    stream.on('error', reject);
  });
}
