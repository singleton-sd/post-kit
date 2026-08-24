import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { BlobServiceClient, ContainerClient, BlobClient } from '@azure/storage-blob';
import type {
  CompiledTemplate,
  TenantContext,
  TemplateSourceMetadata,
} from '@singleton-sd/post-kit-types';
import { PostKitErrorCode, TEMPLATE_SCHEMA_VERSION } from '@singleton-sd/post-kit-types';
import { resetAppConfigurationCache } from '../config/app-configuration';
import { BlobTemplateStore, TemplateStoreError } from './blob-template-store';

// ---------------------------------------------------------------------------
// Fake Azure Blob Storage client
// ---------------------------------------------------------------------------

/** In-memory blob store keyed by `{container}/{blobPath}`. */
type FakeBlobStore = Map<string, string | { notFound: true }>;

/**
 * Build a minimal BlobServiceClient fake that reads from an in-memory map.
 * Supports: getContainerClient → getBlobClient → download (success / 404 / stream).
 */
function makeFakeClient(blobs: FakeBlobStore): BlobServiceClient {
  const getContainerClient = (container: string): ContainerClient => {
    const getBlobClient = (blobPath: string): BlobClient => {
      const key = `${container}/${blobPath}`;
      const download = async () => {
        const entry = blobs.get(key);
        if (entry === undefined || (typeof entry === 'object' && entry.notFound)) {
          // Simulate Azure SDK 404 behaviour — throw with statusCode 404.
          const err = Object.assign(new Error('BlobNotFound'), { statusCode: 404 });
          throw err;
        }
        const content: string = entry as string;
        // Return a minimal download response with a readable stream.
        const stream = stringToReadable(content);
        return {
          readableStreamBody: stream,
          errorCode: undefined,
          _response: { status: 200 },
        };
      };
      return { download } as unknown as BlobClient;
    };
    return { getBlobClient } as unknown as ContainerClient;
  };

  return { getContainerClient } as unknown as BlobServiceClient;
}

function stringToReadable(text: string): NodeJS.ReadableStream {
  const { Readable } = require('node:stream') as typeof import('node:stream');
  return Readable.from([Buffer.from(text, 'utf-8')]);
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const TENANT: TenantContext = { tenantId: 'acme', environment: 'production' };
const TEMPLATE_KEY = 'marketing.contact-us';

const METADATA: TemplateSourceMetadata = {
  key: TEMPLATE_KEY,
  name: 'Contact Us',
  subject: 'New message from {{name}}',
  description: 'Sent from the contact form',
  variables: ['name', 'email', 'message'],
  schemaVersion: TEMPLATE_SCHEMA_VERSION,
};

const HTML = '<html><body>Hello {{name}}</body></html>';

function makeStore(blobs: FakeBlobStore): BlobTemplateStore {
  return new BlobTemplateStore({
    storageAccount: 'testaccount',
    container: 'templates',
    client: makeFakeClient(blobs),
  });
}

function blobKey(path: string): string {
  return `templates/${path}`;
}

function templateBlobKey(tenantId: string, env: string, key: string, file: string): string {
  return blobKey(`tenants/${tenantId}/${env}/templates/${key}/${file}`);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BlobTemplateStore', () => {
  describe('load — successful path', () => {
    it('returns a CompiledTemplate with correct html and metadata', async () => {
      const blobs: FakeBlobStore = new Map([
        [templateBlobKey('acme', 'production', TEMPLATE_KEY, 'template.html'), HTML],
        [
          templateBlobKey('acme', 'production', TEMPLATE_KEY, 'metadata.json'),
          JSON.stringify(METADATA),
        ],
      ]);

      const store = makeStore(blobs);
      const result: CompiledTemplate = await store.load(TENANT, TEMPLATE_KEY);

      assert.equal(result.templateHtml, HTML);
      assert.deepEqual(result.metadata, METADATA);
      assert.equal(result.manifest.key, TEMPLATE_KEY);
      assert.equal(result.manifest.schemaVersion, TEMPLATE_SCHEMA_VERSION);
      assert.deepEqual(result.manifest.variables, METADATA.variables);
      // contentHash is '' as per spec (set at compile time, not load time)
      assert.equal(result.manifest.contentHash, '');
    });
  });

  describe('load — templateKey validation', () => {
    it('rejects a key containing path traversal (../etc)', async () => {
      const store = makeStore(new Map());
      await assert.rejects(
        () => store.load(TENANT, '../etc/passwd'),
        (err: unknown) => {
          assert.ok(err instanceof TemplateStoreError, 'should be TemplateStoreError');
          assert.equal(err.code, PostKitErrorCode.INVALID_TEMPLATE);
          return true;
        },
      );
    });

    it('rejects a key containing a forward slash', async () => {
      const store = makeStore(new Map());
      await assert.rejects(
        () => store.load(TENANT, 'foo/bar'),
        (err: unknown) => {
          assert.ok(err instanceof TemplateStoreError);
          assert.equal((err as TemplateStoreError).code, PostKitErrorCode.INVALID_TEMPLATE);
          return true;
        },
      );
    });

    it('rejects an empty string key', async () => {
      const store = makeStore(new Map());
      await assert.rejects(
        () => store.load(TENANT, ''),
        (err: unknown) => {
          assert.ok(err instanceof TemplateStoreError);
          assert.equal((err as TemplateStoreError).code, PostKitErrorCode.INVALID_TEMPLATE);
          return true;
        },
      );
    });

    it('rejects the bare "." dot-segment key', async () => {
      const store = makeStore(new Map());
      await assert.rejects(
        () => store.load(TENANT, '.'),
        (err: unknown) => {
          assert.ok(err instanceof TemplateStoreError);
          assert.equal((err as TemplateStoreError).code, PostKitErrorCode.INVALID_TEMPLATE);
          return true;
        },
      );
    });

    it('rejects the bare ".." dot-segment key', async () => {
      const store = makeStore(new Map());
      await assert.rejects(
        () => store.load(TENANT, '..'),
        (err: unknown) => {
          assert.ok(err instanceof TemplateStoreError);
          assert.equal((err as TemplateStoreError).code, PostKitErrorCode.INVALID_TEMPLATE);
          return true;
        },
      );
    });

    it('does not make any blob calls for an invalid key', async () => {
      let blobCallCount = 0;
      const blobs: FakeBlobStore = new Map();
      // Track whether any blob was accessed by wrapping the fake
      const trackingBlobs = new Proxy(blobs, {
        get(target, prop, receiver) {
          if (prop === 'get') {
            return (key: string) => {
              blobCallCount++;
              return Reflect.get(target, prop, receiver)(key);
            };
          }
          return Reflect.get(target, prop, receiver);
        },
      });

      const store = makeStore(trackingBlobs);
      await assert.rejects(() => store.load(TENANT, '../traversal'));
      assert.equal(blobCallCount, 0, 'no blob calls should be made for an invalid key');
    });
  });

  describe('load — blob not found', () => {
    it('throws TemplateStoreError with TEMPLATE_NOT_FOUND when html blob is missing', async () => {
      const blobs: FakeBlobStore = new Map([
        // Only metadata exists; html is absent
        [
          templateBlobKey('acme', 'production', TEMPLATE_KEY, 'metadata.json'),
          JSON.stringify(METADATA),
        ],
      ]);

      const store = makeStore(blobs);
      await assert.rejects(
        () => store.load(TENANT, TEMPLATE_KEY),
        (err: unknown) => {
          assert.ok(err instanceof TemplateStoreError);
          assert.equal((err as TemplateStoreError).code, PostKitErrorCode.TEMPLATE_NOT_FOUND);
          return true;
        },
      );
    });

    it('throws TemplateStoreError with TEMPLATE_NOT_FOUND when metadata blob is missing', async () => {
      const blobs: FakeBlobStore = new Map([
        [templateBlobKey('acme', 'production', TEMPLATE_KEY, 'template.html'), HTML],
        // metadata.json is absent
      ]);

      const store = makeStore(blobs);
      await assert.rejects(
        () => store.load(TENANT, TEMPLATE_KEY),
        (err: unknown) => {
          assert.ok(err instanceof TemplateStoreError);
          assert.equal((err as TemplateStoreError).code, PostKitErrorCode.TEMPLATE_NOT_FOUND);
          return true;
        },
      );
    });
  });

  describe('load — malformed metadata', () => {
    it('throws TemplateStoreError with INVALID_TEMPLATE on non-JSON metadata', async () => {
      const blobs: FakeBlobStore = new Map([
        [templateBlobKey('acme', 'production', TEMPLATE_KEY, 'template.html'), HTML],
        [
          templateBlobKey('acme', 'production', TEMPLATE_KEY, 'metadata.json'),
          'NOT_VALID_JSON{{{{',
        ],
      ]);

      const store = makeStore(blobs);
      await assert.rejects(
        () => store.load(TENANT, TEMPLATE_KEY),
        (err: unknown) => {
          assert.ok(err instanceof TemplateStoreError);
          assert.equal((err as TemplateStoreError).code, PostKitErrorCode.INVALID_TEMPLATE);
          return true;
        },
      );
    });

    it('throws TemplateStoreError with INVALID_TEMPLATE on JSON missing required fields', async () => {
      const partial = { key: TEMPLATE_KEY }; // missing name, subject, variables, schemaVersion
      const blobs: FakeBlobStore = new Map([
        [templateBlobKey('acme', 'production', TEMPLATE_KEY, 'template.html'), HTML],
        [
          templateBlobKey('acme', 'production', TEMPLATE_KEY, 'metadata.json'),
          JSON.stringify(partial),
        ],
      ]);

      const store = makeStore(blobs);
      await assert.rejects(
        () => store.load(TENANT, TEMPLATE_KEY),
        (err: unknown) => {
          assert.ok(err instanceof TemplateStoreError);
          assert.equal((err as TemplateStoreError).code, PostKitErrorCode.INVALID_TEMPLATE);
          return true;
        },
      );
    });

    it('throws TemplateStoreError with INVALID_TEMPLATE when metadata.key does not match the requested templateKey', async () => {
      const wrongKeyMetadata: TemplateSourceMetadata = { ...METADATA, key: 'different.template' };
      const blobs: FakeBlobStore = new Map([
        [templateBlobKey('acme', 'production', TEMPLATE_KEY, 'template.html'), HTML],
        [
          templateBlobKey('acme', 'production', TEMPLATE_KEY, 'metadata.json'),
          JSON.stringify(wrongKeyMetadata),
        ],
      ]);

      const store = makeStore(blobs);
      await assert.rejects(
        () => store.load(TENANT, TEMPLATE_KEY),
        (err: unknown) => {
          assert.ok(err instanceof TemplateStoreError);
          assert.equal((err as TemplateStoreError).code, PostKitErrorCode.INVALID_TEMPLATE);
          return true;
        },
      );
    });

    it('throws TemplateStoreError with INVALID_TEMPLATE when metadata.schemaVersion does not match', async () => {
      const wrongVersionMetadata = { ...METADATA, schemaVersion: '0.0.0' };
      const blobs: FakeBlobStore = new Map([
        [templateBlobKey('acme', 'production', TEMPLATE_KEY, 'template.html'), HTML],
        [
          templateBlobKey('acme', 'production', TEMPLATE_KEY, 'metadata.json'),
          JSON.stringify(wrongVersionMetadata),
        ],
      ]);

      const store = makeStore(blobs);
      await assert.rejects(
        () => store.load(TENANT, TEMPLATE_KEY),
        (err: unknown) => {
          assert.ok(err instanceof TemplateStoreError);
          assert.equal((err as TemplateStoreError).code, PostKitErrorCode.INVALID_TEMPLATE);
          return true;
        },
      );
    });

    it('throws TemplateStoreError with INVALID_TEMPLATE when a variable in the variables array is not a string', async () => {
      const nonStringVarMetadata = { ...METADATA, variables: ['name', 42, 'message'] };
      const blobs: FakeBlobStore = new Map([
        [templateBlobKey('acme', 'production', TEMPLATE_KEY, 'template.html'), HTML],
        [
          templateBlobKey('acme', 'production', TEMPLATE_KEY, 'metadata.json'),
          JSON.stringify(nonStringVarMetadata),
        ],
      ]);

      const store = makeStore(blobs);
      await assert.rejects(
        () => store.load(TENANT, TEMPLATE_KEY),
        (err: unknown) => {
          assert.ok(err instanceof TemplateStoreError);
          assert.equal((err as TemplateStoreError).code, PostKitErrorCode.INVALID_TEMPLATE);
          return true;
        },
      );
    });
  });
});

describe('BlobTemplateStore.fromEnv', () => {
  const touched = [
    'AZURE_APPCONFIGURATION_ENDPOINT',
    'TEMPLATE_STORAGE_ACCOUNT',
    'TEMPLATE_STORAGE_CONTAINER',
  ];
  const prior = new Map<string, string | undefined>();

  function restoreEnv(): void {
    for (const [key, value] of prior) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetAppConfigurationCache();
  }

  function clearEnv(): void {
    for (const key of touched) {
      prior.set(key, process.env[key]);
      delete process.env[key];
    }
    resetAppConfigurationCache();
  }

  it('reads TEMPLATE_STORAGE_ACCOUNT from process.env when App Configuration is unset', async () => {
    clearEnv();
    try {
      process.env.TEMPLATE_STORAGE_ACCOUNT = 'localaccount';
      const store = await BlobTemplateStore.fromEnv();
      assert.ok(store instanceof BlobTemplateStore);
    } finally {
      restoreEnv();
    }
  });

  it('loads storage settings from App Configuration before constructing the store', async () => {
    clearEnv();
    try {
      process.env.AZURE_APPCONFIGURATION_ENDPOINT = 'https://example.azconfig.io';
      const store = await BlobTemplateStore.fromEnv({
        listSettings: async function* () {
          yield { key: 'app:templates:storageAccount', value: 'fromappconfig' };
          yield { key: 'app:templates:storageContainer', value: 'compiled-templates' };
        },
      });
      assert.ok(store instanceof BlobTemplateStore);
      assert.equal(process.env.TEMPLATE_STORAGE_ACCOUNT, 'fromappconfig');
      assert.equal(process.env.TEMPLATE_STORAGE_CONTAINER, 'compiled-templates');
    } finally {
      restoreEnv();
    }
  });

  it('throws when TEMPLATE_STORAGE_ACCOUNT is missing after App Configuration load', async () => {
    clearEnv();
    try {
      await assert.rejects(
        () => BlobTemplateStore.fromEnv(),
        /Missing required environment variable: TEMPLATE_STORAGE_ACCOUNT/,
      );
    } finally {
      restoreEnv();
    }
  });
});
