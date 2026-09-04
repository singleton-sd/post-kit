import { createHash } from 'node:crypto';
import type { BlobServiceClient, ContainerClient } from '@azure/storage-blob';
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
 * TTL is enforced on read (expired blobs are ignored and may be overwritten).
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
      await blob.upload(body, body.length, {
        blobHTTPHeaders: { blobContentType: 'application/json' },
        conditions: { ifNoneMatch: '*' },
      });
      return { outcome: 'claimed' };
    } catch (err: unknown) {
      if (!isConflictError(err)) {
        throw new IdempotencyStoreError(
          'Failed to claim idempotency key in storage.',
          PostKitErrorCode.STORAGE_FAILURE,
        );
      }
    }

    const existing = await this.readRecord(blob);
    if (!existing || isExpired(existing)) {
      // Expired or unreadable — overwrite unconditionally and claim.
      try {
        await blob.upload(body, body.length, {
          blobHTTPHeaders: { blobContentType: 'application/json' },
        });
        return { outcome: 'claimed' };
      } catch {
        throw new IdempotencyStoreError(
          'Failed to reclaim expired idempotency key in storage.',
          PostKitErrorCode.STORAGE_FAILURE,
        );
      }
    }

    if (existing.status === 'completed' && existing.response) {
      return { outcome: 'replay', response: existing.response };
    }
    return { outcome: 'in_progress' };
  }

  async complete(tenant: TenantContext, key: string, response: SendResponse): Promise<void> {
    const containerClient = this.client.getContainerClient(this.container);
    const blob = containerClient.getBlockBlobClient(blobPath(tenant, key));
    const record = buildIdempotencyRecord(tenant, key, 'completed', this.ttlMs, response);
    const body = Buffer.from(JSON.stringify(record), 'utf-8');
    try {
      await blob.upload(body, body.length, {
        blobHTTPHeaders: { blobContentType: 'application/json' },
      });
    } catch {
      throw new IdempotencyStoreError(
        'Failed to persist completed idempotency record.',
        PostKitErrorCode.STORAGE_FAILURE,
      );
    }
  }

  async release(tenant: TenantContext, key: string): Promise<void> {
    const containerClient = this.client.getContainerClient(this.container);
    const blob = containerClient.getBlockBlobClient(blobPath(tenant, key));
    try {
      const existing = await this.readRecord(blob);
      if (!existing || existing.status === 'completed') return;
      await blob.deleteIfExists();
    } catch {
      throw new IdempotencyStoreError(
        'Failed to release idempotency claim in storage.',
        PostKitErrorCode.STORAGE_FAILURE,
      );
    }
  }

  private async readRecord(
    blob: ReturnType<ContainerClient['getBlockBlobClient']>,
  ): Promise<IdempotencyRecord | undefined> {
    try {
      const download = await blob.download();
      const text = await streamToString(download.readableStreamBody);
      return parseRecord(text);
    } catch (err: unknown) {
      if (isNotFoundError(err)) return undefined;
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
