import type { BlobServiceClient, StorageSharedKeyCredential } from '@azure/storage-blob';
import { BlobServiceClient as AzureBlobServiceClient } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';
import type {
  CompiledTemplate,
  TenantContext,
  TemplateSourceMetadata,
} from '@singleton-sd/post-kit-types';
import { PostKitErrorCode, TEMPLATE_SCHEMA_VERSION } from '@singleton-sd/post-kit-types';
import type { TemplateStore } from './template-store';

/** Allowlist regex for safe template keys — alphanumeric, dots, hyphens, underscores only. */
const SAFE_TEMPLATE_KEY = /^[a-zA-Z0-9._-]+$/;

/**
 * Error thrown by BlobTemplateStore on load failures.
 * Carries a stable PostKitErrorCode for callers to switch on.
 */
export class TemplateStoreError extends Error {
  readonly code: PostKitErrorCode;

  constructor(message: string, code: PostKitErrorCode) {
    super(message);
    this.name = 'TemplateStoreError';
    this.code = code;
  }
}

export interface BlobTemplateStoreOptions {
  /** Azure Storage account name, e.g. `ssdpostkitstprodae`. */
  storageAccount: string;
  /** Blob container name, e.g. `templates`. */
  container: string;
  /**
   * Azure credential used to authenticate against Blob Storage.
   * Accepts any TokenCredential (DefaultAzureCredential, etc.) or
   * StorageSharedKeyCredential. Defaults to DefaultAzureCredential.
   * Pass a fake/stub for tests.
   */
  credential?: InstanceType<typeof DefaultAzureCredential> | StorageSharedKeyCredential;
  /**
   * Optional pre-built BlobServiceClient for testing.
   * When provided, storageAccount and credential are ignored for client construction.
   */
  client?: BlobServiceClient;
}

/**
 * Azure Blob Storage implementation of TemplateStore.
 *
 * Blob layout:
 *   tenants/{tenantId}/{environment}/templates/{templateKey}/template.html
 *   tenants/{tenantId}/{environment}/templates/{templateKey}/metadata.json
 *
 * Construction with dependency injection (for tests):
 * ```ts
 * new BlobTemplateStore({ storageAccount: 'x', container: 'y', client: fakeClient });
 * ```
 *
 * Production construction (reads from env):
 * ```ts
 * BlobTemplateStore.fromEnv()
 * ```
 */
export class BlobTemplateStore implements TemplateStore {
  private readonly client: BlobServiceClient;
  private readonly container: string;

  constructor(options: BlobTemplateStoreOptions) {
    this.container = options.container;

    if (options.client) {
      this.client = options.client;
    } else {
      const credential = options.credential ?? new DefaultAzureCredential();
      const url = `https://${options.storageAccount}.blob.core.windows.net`;
      this.client = new AzureBlobServiceClient(url, credential);
    }
  }

  /**
   * Create a BlobTemplateStore from environment variables.
   * Reads TEMPLATE_STORAGE_ACCOUNT and TEMPLATE_STORAGE_CONTAINER.
   */
  static fromEnv(): BlobTemplateStore {
    const storageAccount = process.env['TEMPLATE_STORAGE_ACCOUNT'];
    const container = process.env['TEMPLATE_STORAGE_CONTAINER'] ?? 'templates';

    if (!storageAccount) {
      throw new Error('Missing required environment variable: TEMPLATE_STORAGE_ACCOUNT');
    }

    return new BlobTemplateStore({ storageAccount, container });
  }

  /**
   * Load a compiled template artifact from Azure Blob Storage.
   *
   * @throws {TemplateStoreError} TEMPLATE_NOT_FOUND — blob does not exist (404)
   * @throws {TemplateStoreError} INVALID_TEMPLATE   — metadata JSON is malformed
   */
  async load(tenant: TenantContext, templateKey: string): Promise<CompiledTemplate> {
    validateTemplateKey(templateKey);

    const { tenantId, environment } = tenant;
    const basePath = `tenants/${tenantId}/${environment}/templates/${templateKey}`;

    const containerClient = this.client.getContainerClient(this.container);

    const [templateHtml, metadataJson] = await Promise.all([
      downloadBlob(containerClient, `${basePath}/template.html`),
      downloadBlob(containerClient, `${basePath}/metadata.json`),
    ]);

    const metadata = parseMetadata(metadataJson, templateKey);

    return {
      templateHtml,
      metadata,
      manifest: {
        key: metadata.key,
        schemaVersion: TEMPLATE_SCHEMA_VERSION,
        compiledAt: '',
        sourceCommit: '',
        variables: metadata.variables,
        contentHash: '',
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function validateTemplateKey(templateKey: string): void {
  // Reject empty, non-matching, or bare dot-segment keys ("." and "..") even
  // though "." technically satisfies the character allowlist.
  if (
    !templateKey ||
    !SAFE_TEMPLATE_KEY.test(templateKey) ||
    templateKey === '.' ||
    templateKey === '..'
  ) {
    throw new TemplateStoreError(
      `Invalid templateKey: "${templateKey}". Must match /^[a-zA-Z0-9._-]+$/ and must not be a bare dot-segment.`,
      PostKitErrorCode.INVALID_TEMPLATE,
    );
  }
}

async function downloadBlob(
  containerClient: ReturnType<BlobServiceClient['getContainerClient']>,
  blobPath: string,
): Promise<string> {
  const blobClient = containerClient.getBlobClient(blobPath);

  let downloadResponse: Awaited<ReturnType<typeof blobClient.download>>;
  try {
    downloadResponse = await blobClient.download();
  } catch (err: unknown) {
    if (isNotFoundError(err)) {
      throw new TemplateStoreError(
        `Template blob not found: ${blobPath}`,
        PostKitErrorCode.TEMPLATE_NOT_FOUND,
      );
    }
    throw err;
  }

  if (downloadResponse.errorCode === 'BlobNotFound' || downloadResponse._response?.status === 404) {
    throw new TemplateStoreError(
      `Template blob not found: ${blobPath}`,
      PostKitErrorCode.TEMPLATE_NOT_FOUND,
    );
  }

  const content = await streamToString(downloadResponse.readableStreamBody);
  return content;
}

function parseMetadata(json: string, templateKey: string): TemplateSourceMetadata {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new TemplateStoreError(
      `Failed to parse metadata.json for template "${templateKey}": invalid JSON`,
      PostKitErrorCode.INVALID_TEMPLATE,
    );
  }

  if (!isTemplateSourceMetadata(parsed)) {
    throw new TemplateStoreError(
      `metadata.json for template "${templateKey}" is missing required fields or has invalid types`,
      PostKitErrorCode.INVALID_TEMPLATE,
    );
  }

  if (parsed.key !== templateKey) {
    throw new TemplateStoreError(
      `metadata.json key "${parsed.key}" does not match requested templateKey "${templateKey}"`,
      PostKitErrorCode.INVALID_TEMPLATE,
    );
  }

  if (parsed.schemaVersion !== TEMPLATE_SCHEMA_VERSION) {
    throw new TemplateStoreError(
      `metadata.json for template "${templateKey}" has unsupported schemaVersion "${parsed.schemaVersion}" (expected "${TEMPLATE_SCHEMA_VERSION}")`,
      PostKitErrorCode.INVALID_TEMPLATE,
    );
  }

  return parsed;
}

function isTemplateSourceMetadata(value: unknown): value is TemplateSourceMetadata {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj['key'] === 'string' &&
    typeof obj['name'] === 'string' &&
    typeof obj['subject'] === 'string' &&
    Array.isArray(obj['variables']) &&
    (obj['variables'] as unknown[]).every((v) => typeof v === 'string') &&
    typeof obj['schemaVersion'] === 'string'
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
