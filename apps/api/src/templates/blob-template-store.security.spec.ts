import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { describe, it } from 'node:test';
import type { BlobClient, BlobServiceClient, ContainerClient } from '@azure/storage-blob';
import type { TemplateSourceMetadata, TenantContext } from '@singleton-sd/post-kit-types';
import { PostKitErrorCode, TEMPLATE_SCHEMA_VERSION } from '@singleton-sd/post-kit-types';
import { BlobTemplateStore, TemplateStoreError } from './blob-template-store';

// ---------------------------------------------------------------------------
// Fake Azure Blob Storage client (same shape as blob-template-store.spec.ts,
// with the requested blob paths recorded so path confinement is assertable).
// ---------------------------------------------------------------------------

interface FakeClient {
  client: BlobServiceClient;
  requestedPaths: string[];
}

function makeRecordingClient(blobs: Map<string, string>): FakeClient {
  const requestedPaths: string[] = [];

  const getContainerClient = (container: string): ContainerClient => {
    const getBlobClient = (blobPath: string): BlobClient => {
      requestedPaths.push(blobPath);
      const key = `${container}/${blobPath}`;
      const download = async () => {
        const entry = blobs.get(key);
        if (entry === undefined) {
          throw Object.assign(new Error('BlobNotFound'), { statusCode: 404 });
        }
        return {
          readableStreamBody: Readable.from([Buffer.from(entry, 'utf-8')]),
          errorCode: undefined,
          _response: { status: 200 },
        };
      };
      return { download } as unknown as BlobClient;
    };
    return { getBlobClient } as unknown as ContainerClient;
  };

  return { client: { getContainerClient } as unknown as BlobServiceClient, requestedPaths };
}

const TEMPLATE_KEY = 'marketing.contact-us';

const METADATA: TemplateSourceMetadata = {
  key: TEMPLATE_KEY,
  name: 'Contact Us',
  subject: 'New message from {{name}}',
  variables: ['name'],
  schemaVersion: TEMPLATE_SCHEMA_VERSION,
};

const HTML = '<html><body>Hello {{name}}</body></html>';

function seedTemplate(
  blobs: Map<string, string>,
  tenantId: string,
  environment: string,
  key = TEMPLATE_KEY,
): void {
  const base = `templates/tenants/${tenantId}/${environment}/templates/${key}`;
  blobs.set(`${base}/template.html`, HTML);
  blobs.set(`${base}/metadata.json`, JSON.stringify({ ...METADATA, key }));
}

function makeStore(client: BlobServiceClient): BlobTemplateStore {
  return new BlobTemplateStore({ storageAccount: 'testaccount', container: 'templates', client });
}

async function expectNotFound(run: () => Promise<unknown>): Promise<void> {
  await assert.rejects(run, (err: unknown) => {
    assert.ok(err instanceof TemplateStoreError, 'expected TemplateStoreError');
    assert.equal(err.code, PostKitErrorCode.TEMPLATE_NOT_FOUND);
    return true;
  });
}

describe('BlobTemplateStore — cross-tenant isolation', () => {
  it('does not serve tenant B templates to a tenant A credential, even for a known key', async () => {
    const blobs = new Map<string, string>();
    seedTemplate(blobs, 'tenant-b', 'production');
    const { client, requestedPaths } = makeRecordingClient(blobs);

    const tenantA: TenantContext = { tenantId: 'tenant-a', environment: 'production' };
    await expectNotFound(() => makeStore(client).load(tenantA, TEMPLATE_KEY));

    assert.ok(requestedPaths.length > 0, 'store should have attempted its own tenant prefix');
    for (const path of requestedPaths) {
      assert.ok(
        path.startsWith('tenants/tenant-a/production/templates/'),
        `blob path escaped the tenant prefix: ${path}`,
      );
    }
  });

  it('serves each tenant only from its own prefix when both tenants share a key', async () => {
    const blobs = new Map<string, string>();
    seedTemplate(blobs, 'tenant-a', 'production');
    blobs.set(
      `templates/tenants/tenant-a/production/templates/${TEMPLATE_KEY}/template.html`,
      '<p>tenant-a</p>',
    );
    seedTemplate(blobs, 'tenant-b', 'production');
    blobs.set(
      `templates/tenants/tenant-b/production/templates/${TEMPLATE_KEY}/template.html`,
      '<p>tenant-b</p>',
    );
    const { client } = makeRecordingClient(blobs);
    const store = makeStore(client);

    const a = await store.load({ tenantId: 'tenant-a', environment: 'production' }, TEMPLATE_KEY);
    const b = await store.load({ tenantId: 'tenant-b', environment: 'production' }, TEMPLATE_KEY);

    assert.equal(a.templateHtml, '<p>tenant-a</p>');
    assert.equal(b.templateHtml, '<p>tenant-b</p>');
  });

  it('confines every blob path to tenants/{tenant}/{env}/templates/{key}/', async () => {
    const blobs = new Map<string, string>();
    seedTemplate(blobs, 'tenant-a', 'staging');
    const { client, requestedPaths } = makeRecordingClient(blobs);

    await makeStore(client).load({ tenantId: 'tenant-a', environment: 'staging' }, TEMPLATE_KEY);

    assert.deepEqual(requestedPaths.slice().sort(), [
      `tenants/tenant-a/staging/templates/${TEMPLATE_KEY}/metadata.json`,
      `tenants/tenant-a/staging/templates/${TEMPLATE_KEY}/template.html`,
    ]);
  });
});

describe('BlobTemplateStore — environment isolation', () => {
  it('does not serve production artifacts to a development credential', async () => {
    const blobs = new Map<string, string>();
    seedTemplate(blobs, 'tenant-a', 'production');
    const { client, requestedPaths } = makeRecordingClient(blobs);

    await expectNotFound(() =>
      makeStore(client).load({ tenantId: 'tenant-a', environment: 'development' }, TEMPLATE_KEY),
    );

    for (const path of requestedPaths) {
      assert.ok(
        path.startsWith('tenants/tenant-a/development/templates/'),
        `blob path escaped the environment prefix: ${path}`,
      );
    }
  });

  it('does not serve development artifacts to a production credential', async () => {
    const blobs = new Map<string, string>();
    seedTemplate(blobs, 'tenant-a', 'development');
    const { client } = makeRecordingClient(blobs);

    await expectNotFound(() =>
      makeStore(client).load({ tenantId: 'tenant-a', environment: 'production' }, TEMPLATE_KEY),
    );
  });
});

describe('BlobTemplateStore — tenant identity path validation', () => {
  async function expectInvalidTemplate(
    run: () => Promise<unknown>,
    requestedPaths: string[],
  ): Promise<void> {
    await assert.rejects(run, (err: unknown) => {
      assert.ok(err instanceof TemplateStoreError, 'expected TemplateStoreError');
      assert.equal(err.code, PostKitErrorCode.INVALID_TEMPLATE);
      return true;
    });
    assert.deepEqual(requestedPaths, [], 'no blob access may happen for an unsafe tenant path');
  }

  it('rejects a slash-bearing tenantId before storage access', async () => {
    const blobs = new Map<string, string>();
    const tenantId = 'tenant-a/production/templates/shared';
    const base = `templates/tenants/${tenantId}/production/templates/${TEMPLATE_KEY}`;
    blobs.set(`${base}/template.html`, HTML);
    blobs.set(`${base}/metadata.json`, JSON.stringify(METADATA));
    const { client, requestedPaths } = makeRecordingClient(blobs);

    const unvalidated = { tenantId, environment: 'production' } as unknown as TenantContext;
    await expectInvalidTemplate(
      () => makeStore(client).load(unvalidated, TEMPLATE_KEY),
      requestedPaths,
    );
  });

  it('rejects an environment value that is not a TenantEnvironment before storage access', async () => {
    const blobs = new Map<string, string>();
    const base = `templates/tenants/tenant-a/elsewhere/templates/${TEMPLATE_KEY}`;
    blobs.set(`${base}/template.html`, HTML);
    blobs.set(`${base}/metadata.json`, JSON.stringify(METADATA));
    const { client, requestedPaths } = makeRecordingClient(blobs);

    const unvalidated = {
      tenantId: 'tenant-a',
      environment: 'elsewhere',
    } as unknown as TenantContext;

    await expectInvalidTemplate(
      () => makeStore(client).load(unvalidated, TEMPLATE_KEY),
      requestedPaths,
    );
  });

  const unsafeTenantIds: Array<[label: string, tenantId: string]> = [
    ['empty tenantId', ''],
    ['parent traversal', '../tenant-b'],
    ['nested slash', 'a/b'],
    ['leading hyphen', '-acme'],
    ['trailing hyphen', 'acme-'],
    ['double dot segment', 'a..b'],
  ];

  for (const [label, tenantId] of unsafeTenantIds) {
    it(`rejects ${label} with INVALID_TEMPLATE and makes no blob call`, async () => {
      const { client, requestedPaths } = makeRecordingClient(new Map());
      await expectInvalidTemplate(
        () =>
          makeStore(client).load(
            { tenantId, environment: 'production' } as unknown as TenantContext,
            TEMPLATE_KEY,
          ),
        requestedPaths,
      );
    });
  }
});

describe('BlobTemplateStore — unsafe template keys are rejected before storage access', () => {
  const unsafeKeys: Array<[label: string, key: string]> = [
    ['parent traversal', '../tenant-b/production/templates/x'],
    ['nested traversal', 'a/../../b'],
    ['absolute path', '/etc/passwd'],
    ['windows absolute path', 'C:\\secrets'],
    ['URL-encoded traversal', '%2e%2e%2ftenant-b'],
    ['double URL-encoded traversal', '%252e%252e%252f'],
    ['empty segment', 'a//b'],
    ['trailing slash', `${TEMPLATE_KEY}/`],
    ['null byte', `${TEMPLATE_KEY}\u0000.html`],
    ['newline', `${TEMPLATE_KEY}\ntemplate`],
    ['backslash traversal', '..\\tenant-b'],
    ['whitespace', 'contact us'],
    ['wildcard', 'contact-*'],
    ['query string', `${TEMPLATE_KEY}?snapshot=1`],
    ['empty key', ''],
    ['bare dot', '.'],
    ['bare dot-dot', '..'],
  ];

  for (const [label, key] of unsafeKeys) {
    it(`rejects ${label} with INVALID_TEMPLATE and makes no blob call`, async () => {
      const { client, requestedPaths } = makeRecordingClient(new Map());
      await assert.rejects(
        () => makeStore(client).load({ tenantId: 'tenant-a', environment: 'production' }, key),
        (err: unknown) => {
          assert.ok(err instanceof TemplateStoreError, 'expected TemplateStoreError');
          assert.equal(err.code, PostKitErrorCode.INVALID_TEMPLATE);
          return true;
        },
      );
      assert.deepEqual(requestedPaths, [], 'no blob access may happen for an unsafe key');
    });
  }
});
