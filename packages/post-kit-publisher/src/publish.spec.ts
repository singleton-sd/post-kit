import assert from 'node:assert/strict';
import { mkdtemp, writeFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import type { BlobServiceClient, ContainerClient, BlockBlobClient } from '@azure/storage-blob';
import {
  assertSafeEnvironment,
  assertSafeStorageAccount,
  assertSafeTenantId,
  assertSafeTemplateKey,
  blobBasePath,
  templatesPrefix,
  isScopedTemplateBlob,
  templateKeyFromBlobPath,
} from './path-safety';
import { publishTemplatesWithClient } from './publish';

const FIXTURES = join(import.meta.dirname, '../../post-kit-compiler/src/fixtures');

describe('path safety', () => {
  it('rejects unsafe tenant ids', () => {
    assert.throws(() => assertSafeTenantId('../x'));
    assert.throws(() => assertSafeTenantId(''));
    assert.throws(() => assertSafeTenantId('a/b'));
    assert.doesNotThrow(() => assertSafeTenantId('inkads'));
  });

  it('rejects invalid environments', () => {
    assert.throws(() => assertSafeEnvironment('prod'));
    assert.doesNotThrow(() => assertSafeEnvironment('production'));
  });

  it('rejects unsafe template keys', () => {
    assert.throws(() => assertSafeTemplateKey('..'));
    assert.throws(() => assertSafeTemplateKey('.'));
    assert.throws(() => assertSafeTemplateKey('a/b'));
    assert.doesNotThrow(() => assertSafeTemplateKey('marketing.contact-us'));
  });

  it('rejects unsafe storage account names', () => {
    assert.throws(() => assertSafeStorageAccount('attacker.example/'));
    assert.throws(() => assertSafeStorageAccount('Ab'));
    assert.throws(() => assertSafeStorageAccount('UPPERCASEACCOUNT'));
    assert.doesNotThrow(() => assertSafeStorageAccount('ssdpostkitstprodae'));
  });

  it('builds the TemplateStore blob base path', () => {
    assert.equal(
      blobBasePath('inkads', 'production', 'marketing.contact-us'),
      'tenants/inkads/production/templates/marketing.contact-us',
    );
  });

  it('builds the templates prefix for listing and prune scope', () => {
    assert.equal(templatesPrefix('inkads', 'production'), 'tenants/inkads/production/templates');
  });

  it('scopes template blobs under the templates prefix', () => {
    const prefix = templatesPrefix('inkads', 'production');
    assert.equal(
      isScopedTemplateBlob(
        'tenants/inkads/production/templates/marketing.contact-us/template.html',
        prefix,
      ),
      true,
    );
    assert.equal(
      isScopedTemplateBlob(
        'tenants/inkads/production/other/marketing.contact-us/template.html',
        prefix,
      ),
      false,
    );
    assert.equal(
      isScopedTemplateBlob(
        'tenants/other/production/templates/marketing.contact-us/template.html',
        prefix,
      ),
      false,
    );
    assert.equal(
      templateKeyFromBlobPath(
        'tenants/inkads/production/templates/marketing.contact-us/metadata.json',
        prefix,
      ),
      'marketing.contact-us',
    );
  });
});

describe('publishTemplates', () => {
  it('does not upload when compilation fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'post-kit-publish-'));
    await cp(join(FIXTURES, 'malformed-metadata'), join(root, 'bad'), { recursive: true });
    await writeFile(
      join(root, 'bad', 'template.json'),
      JSON.stringify({ root: { type: 'EmailLayout', data: { childrenIds: [] } } }),
    );
    await writeFile(join(root, 'bad', 'preview.json'), '{}');

    let uploads = 0;
    const client = makeFakeClient(() => {
      uploads += 1;
    });

    const result = await publishTemplatesWithClient(
      {
        templatesDir: root,
        tenant: 'inkads',
        environment: 'development',
        storageAccount: 'ssdpostkitstprodae',
        container: 'templates',
      },
      client,
    );

    assert.equal(result.published.length, 0);
    assert.ok(result.failed.length >= 1);
    assert.equal(uploads, 0);
  });

  it('does not upload when two directories share the same template key', async () => {
    const root = await mkdtemp(join(tmpdir(), 'post-kit-publish-'));
    await cp(join(FIXTURES, 'marketing.contact-us'), join(root, 'copy-a'), { recursive: true });
    await cp(join(FIXTURES, 'marketing.contact-us'), join(root, 'copy-b'), { recursive: true });

    let uploads = 0;
    const client = makeFakeClient(() => {
      uploads += 1;
    });

    const result = await publishTemplatesWithClient(
      {
        templatesDir: root,
        tenant: 'inkads',
        environment: 'production',
        storageAccount: 'ssdpostkitstprodae',
        container: 'templates',
      },
      client,
    );

    assert.equal(result.published.length, 0);
    assert.ok(result.failed.some((f) => f.error.includes('Duplicate template key')));
    assert.equal(uploads, 0);
  });

  it('uploads template.html, metadata.json, and manifest.json for a valid fixture', async () => {
    const root = await mkdtemp(join(tmpdir(), 'post-kit-publish-'));
    await cp(join(FIXTURES, 'marketing.contact-us'), join(root, 'marketing.contact-us'), {
      recursive: true,
    });

    const uploaded = new Map<string, UploadedBlob>();
    let listCalls = 0;
    const client = makeFakeClient({
      onUpload: (path, body, headers) => {
        uploaded.set(path, { body, contentType: headers?.blobContentType });
      },
      onList: () => {
        listCalls += 1;
      },
    });

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    };

    try {
      const result = await publishTemplatesWithClient(
        {
          templatesDir: root,
          tenant: 'inkads',
          environment: 'production',
          storageAccount: 'ssdpostkitstprodae',
          container: 'templates',
          commit: 'abc123',
        },
        client,
      );

      assert.deepEqual(result.published, ['marketing.contact-us']);
      assert.equal(result.failed.length, 0);
      assert.equal(listCalls, 0);

      const base = 'tenants/inkads/production/templates/marketing.contact-us';
      assert.ok(uploaded.has(`${base}/template.html`));
      assert.ok(uploaded.has(`${base}/metadata.json`));
      assert.ok(uploaded.has(`${base}/manifest.json`));

      const meta = JSON.parse(uploaded.get(`${base}/metadata.json`)!.body);
      assert.equal(meta.key, 'marketing.contact-us');

      const manifest = JSON.parse(uploaded.get(`${base}/manifest.json`)!.body);
      assert.equal(manifest.key, 'marketing.contact-us');
      assert.equal(manifest.sourceCommit, 'abc123');
      assert.ok(manifest.contentHash.length > 0);
      assert.ok(manifest.compiledAt.length > 0);
      assert.equal(
        uploaded.get(`${base}/manifest.json`)!.contentType,
        'application/json; charset=utf-8',
      );

      const html = uploaded.get(`${base}/template.html`)!.body;
      assert.ok(html.includes('<html') || html.includes('<!DOCTYPE') || html.length > 0);

      assert.equal(logs.length, 1);
      const stdoutLine = JSON.parse(logs[0]!);
      assert.equal(stdoutLine.key, 'marketing.contact-us');
      assert.equal(stdoutLine.contentHash, manifest.contentHash);
      assert.equal(stdoutLine.templateHtml, `${base}/template.html`);
      assert.equal(stdoutLine.metadataJson, `${base}/metadata.json`);
      assert.equal(Object.keys(stdoutLine).length, 4);
    } finally {
      console.log = originalLog;
    }
  });

  it('prunes all scoped blobs for a retired template key, including stale files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'post-kit-publish-'));
    await cp(join(FIXTURES, 'marketing.contact-us'), join(root, 'marketing.contact-us'), {
      recursive: true,
    });

    const prefix = 'tenants/inkads/production/templates';
    const blobs = new Map<string, string>([
      [`${prefix}/marketing.contact-us/template.html`, '<html></html>'],
      [`${prefix}/marketing.contact-us/metadata.json`, '{}'],
      [`${prefix}/retired.welcome/template.html`, '<html>old</html>'],
      [`${prefix}/retired.welcome/metadata.json`, '{}'],
      [`${prefix}/retired.welcome/preview.json`, '{}'],
    ]);
    const deleted: string[] = [];
    const client = makeFakeClient({
      blobs,
      onUpload: () => {},
      onDelete: (path) => deleted.push(path),
    });

    const result = await publishTemplatesWithClient(
      {
        templatesDir: root,
        tenant: 'inkads',
        environment: 'production',
        storageAccount: 'ssdpostkitstprodae',
        container: 'templates',
        prune: true,
      },
      client,
    );

    assert.deepEqual(result.deleted, ['retired.welcome']);
    assert.ok(deleted.includes(`${prefix}/retired.welcome/preview.json`));
    assert.ok(!blobs.has(`${prefix}/retired.welcome/preview.json`));
  });

  it('does not prune by default when storage has extra template keys', async () => {
    const root = await mkdtemp(join(tmpdir(), 'post-kit-publish-'));
    await cp(join(FIXTURES, 'marketing.contact-us'), join(root, 'marketing.contact-us'), {
      recursive: true,
    });

    const prefix = 'tenants/inkads/production/templates';
    const blobs = new Map<string, string>([
      [`${prefix}/marketing.contact-us/template.html`, '<html></html>'],
      [`${prefix}/marketing.contact-us/metadata.json`, '{}'],
      [`${prefix}/retired.welcome/template.html`, '<html>old</html>'],
      [`${prefix}/retired.welcome/metadata.json`, '{}'],
    ]);
    const deleted: string[] = [];
    const client = makeFakeClient({
      blobs,
      onUpload: () => {},
      onDelete: (path) => deleted.push(path),
    });

    const result = await publishTemplatesWithClient(
      {
        templatesDir: root,
        tenant: 'inkads',
        environment: 'production',
        storageAccount: 'ssdpostkitstprodae',
        container: 'templates',
      },
      client,
    );

    assert.deepEqual(result.published, ['marketing.contact-us']);
    assert.deepEqual(result.deleted, []);
    assert.equal(deleted.length, 0);
    assert.ok(blobs.has(`${prefix}/retired.welcome/template.html`));
  });

  it('prunes blobs for keys absent from the compiled set', async () => {
    const root = await mkdtemp(join(tmpdir(), 'post-kit-publish-'));
    await cp(join(FIXTURES, 'marketing.contact-us'), join(root, 'marketing.contact-us'), {
      recursive: true,
    });

    const prefix = 'tenants/inkads/production/templates';
    const blobs = new Map<string, string>([
      [`${prefix}/marketing.contact-us/template.html`, '<html></html>'],
      [`${prefix}/marketing.contact-us/metadata.json`, '{}'],
      [`${prefix}/retired.welcome/template.html`, '<html>old</html>'],
      [`${prefix}/retired.welcome/metadata.json`, '{}'],
    ]);
    const deleted: string[] = [];
    const client = makeFakeClient({
      blobs,
      onUpload: () => {},
      onDelete: (path) => deleted.push(path),
    });

    const result = await publishTemplatesWithClient(
      {
        templatesDir: root,
        tenant: 'inkads',
        environment: 'production',
        storageAccount: 'ssdpostkitstprodae',
        container: 'templates',
        prune: true,
      },
      client,
    );

    assert.deepEqual(result.published, ['marketing.contact-us']);
    assert.deepEqual(result.deleted, ['retired.welcome']);
    assert.ok(deleted.includes(`${prefix}/retired.welcome/template.html`));
    assert.ok(deleted.includes(`${prefix}/retired.welcome/metadata.json`));
    assert.ok(!blobs.has(`${prefix}/retired.welcome/template.html`));
  });

  it('does not prune blobs outside the tenant/environment templates prefix', async () => {
    const root = await mkdtemp(join(tmpdir(), 'post-kit-publish-'));
    await cp(join(FIXTURES, 'marketing.contact-us'), join(root, 'marketing.contact-us'), {
      recursive: true,
    });

    const prefix = 'tenants/inkads/production/templates';
    const blobs = new Map<string, string>([
      [`${prefix}/marketing.contact-us/template.html`, '<html></html>'],
      [`${prefix}/marketing.contact-us/metadata.json`, '{}'],
      ['tenants/other/production/templates/retired.welcome/template.html', '<html>other</html>'],
      ['tenants/inkads/staging/templates/retired.welcome/template.html', '<html>staging</html>'],
      ['tenants/inkads/production/other/retired.welcome/template.html', '<html>wrong</html>'],
    ]);
    const deleted: string[] = [];
    const client = makeFakeClient({
      blobs,
      onUpload: () => {},
      onDelete: (path) => deleted.push(path),
    });

    await publishTemplatesWithClient(
      {
        templatesDir: root,
        tenant: 'inkads',
        environment: 'production',
        storageAccount: 'ssdpostkitstprodae',
        container: 'templates',
        prune: true,
      },
      client,
    );

    assert.equal(deleted.length, 0);
    assert.ok(blobs.has('tenants/other/production/templates/retired.welcome/template.html'));
    assert.ok(blobs.has('tenants/inkads/staging/templates/retired.welcome/template.html'));
    assert.ok(blobs.has('tenants/inkads/production/other/retired.welcome/template.html'));
  });

  it('dry-run reports adds, updates, and deletions without writes or deletes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'post-kit-publish-'));
    await cp(join(FIXTURES, 'marketing.contact-us'), join(root, 'marketing.contact-us'), {
      recursive: true,
    });

    const prefix = 'tenants/inkads/production/templates';
    const blobs = new Map<string, string>([
      [`${prefix}/marketing.contact-us/template.html`, '<html>old</html>'],
      [`${prefix}/marketing.contact-us/metadata.json`, '{}'],
      [`${prefix}/retired.welcome/template.html`, '<html>gone</html>'],
      [`${prefix}/retired.welcome/metadata.json`, '{}'],
    ]);
    let uploads = 0;
    const deleted: string[] = [];
    const client = makeFakeClient({
      blobs,
      onUpload: () => {
        uploads += 1;
      },
      onDelete: (path) => deleted.push(path),
    });

    const result = await publishTemplatesWithClient(
      {
        templatesDir: root,
        tenant: 'inkads',
        environment: 'production',
        storageAccount: 'ssdpostkitstprodae',
        container: 'templates',
        dryRun: true,
        prune: true,
      },
      client,
    );

    assert.equal(result.published.length, 0);
    assert.deepEqual(result.added, []);
    assert.deepEqual(result.updated, ['marketing.contact-us']);
    assert.deepEqual(result.deleted, ['retired.welcome']);
    assert.equal(uploads, 0);
    assert.equal(deleted.length, 0);
    assert.ok(blobs.has(`${prefix}/retired.welcome/template.html`));
  });

  it('dry-run reports a new template as an add', async () => {
    const root = await mkdtemp(join(tmpdir(), 'post-kit-publish-'));
    await cp(join(FIXTURES, 'marketing.contact-us'), join(root, 'marketing.contact-us'), {
      recursive: true,
    });

    const blobs = new Map<string, string>();
    let uploads = 0;
    const client = makeFakeClient({
      blobs,
      onUpload: () => {
        uploads += 1;
      },
      onDelete: () => {},
    });

    const result = await publishTemplatesWithClient(
      {
        templatesDir: root,
        tenant: 'inkads',
        environment: 'production',
        storageAccount: 'ssdpostkitstprodae',
        container: 'templates',
        dryRun: true,
      },
      client,
    );

    assert.deepEqual(result.added, ['marketing.contact-us']);
    assert.deepEqual(result.updated, []);
    assert.deepEqual(result.deleted, []);
    assert.equal(uploads, 0);
  });

  it('does not prune when compilation fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'post-kit-publish-'));
    await cp(join(FIXTURES, 'malformed-metadata'), join(root, 'bad'), { recursive: true });
    await writeFile(
      join(root, 'bad', 'template.json'),
      JSON.stringify({ root: { type: 'EmailLayout', data: { childrenIds: [] } } }),
    );
    await writeFile(join(root, 'bad', 'preview.json'), '{}');

    const prefix = 'tenants/inkads/development/templates';
    const blobs = new Map<string, string>([
      [`${prefix}/retired.welcome/template.html`, '<html>old</html>'],
    ]);
    const deleted: string[] = [];
    const client = makeFakeClient({
      blobs,
      onUpload: () => {},
      onDelete: (path) => deleted.push(path),
    });

    const result = await publishTemplatesWithClient(
      {
        templatesDir: root,
        tenant: 'inkads',
        environment: 'development',
        storageAccount: 'ssdpostkitstprodae',
        container: 'templates',
        prune: true,
      },
      client,
    );

    assert.equal(result.published.length, 0);
    assert.ok(result.failed.length >= 1);
    assert.equal(deleted.length, 0);
  });
});

interface UploadedBlob {
  body: string;
  contentType?: string;
}

interface FakeClientOptions {
  blobs?: Map<string, string>;
  onUpload: (path: string, body: string, headers?: { blobContentType?: string }) => void;
  onDelete?: (path: string) => void;
  onList?: () => void;
}

function makeFakeClient(
  options:
    | FakeClientOptions
    | ((path: string, body: string, headers?: { blobContentType?: string }) => void),
): BlobServiceClient {
  const opts: FakeClientOptions =
    typeof options === 'function' ? { onUpload: options, blobs: new Map() } : options;
  const blobs = opts.blobs ?? new Map<string, string>();

  const getBlockBlobClient = (blobPath: string): BlockBlobClient =>
    ({
      upload: async (
        body: string | Buffer,
        _length: number,
        options?: { blobHTTPHeaders?: { blobContentType?: string } },
      ) => {
        const text = typeof body === 'string' ? body : body.toString('utf8');
        opts.onUpload(blobPath, text, options?.blobHTTPHeaders);
        blobs.set(blobPath, text);
        return {};
      },
      delete: async () => {
        opts.onDelete?.(blobPath);
        blobs.delete(blobPath);
        return {};
      },
      deleteIfExists: async () => {
        if (blobs.has(blobPath)) {
          opts.onDelete?.(blobPath);
          blobs.delete(blobPath);
          return { succeeded: true };
        }
        return { succeeded: false };
      },
    }) as unknown as BlockBlobClient;

  const getContainerClient = (): ContainerClient =>
    ({
      getBlockBlobClient,
      listBlobsFlat: (listOptions?: { prefix?: string }) => ({
        async *[Symbol.asyncIterator]() {
          opts.onList?.();
          const prefix = listOptions?.prefix ?? '';
          for (const name of [...blobs.keys()].sort()) {
            if (name.startsWith(prefix)) {
              yield { name };
            }
          }
        },
      }),
    }) as unknown as ContainerClient;

  return { getContainerClient } as unknown as BlobServiceClient;
}
