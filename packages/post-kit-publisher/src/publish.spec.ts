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

  it('uploads template.html and metadata.json for a valid fixture', async () => {
    const root = await mkdtemp(join(tmpdir(), 'post-kit-publish-'));
    await cp(join(FIXTURES, 'marketing.contact-us'), join(root, 'marketing.contact-us'), {
      recursive: true,
    });

    const uploaded = new Map<string, string>();
    const client = makeFakeClient((path, body) => {
      uploaded.set(path, body);
    });

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
    assert.ok(
      uploaded.has('tenants/inkads/production/templates/marketing.contact-us/template.html'),
    );
    assert.ok(
      uploaded.has('tenants/inkads/production/templates/marketing.contact-us/metadata.json'),
    );
    const meta = JSON.parse(
      uploaded.get('tenants/inkads/production/templates/marketing.contact-us/metadata.json')!,
    );
    assert.equal(meta.key, 'marketing.contact-us');
    const html = uploaded.get(
      'tenants/inkads/production/templates/marketing.contact-us/template.html',
    )!;
    assert.ok(html.includes('<html') || html.includes('<!DOCTYPE') || html.length > 0);
  });
});

function makeFakeClient(onUpload: (path: string, body: string) => void): BlobServiceClient {
  const getBlockBlobClient = (blobPath: string): BlockBlobClient =>
    ({
      upload: async (body: string | Buffer) => {
        const text = typeof body === 'string' ? body : body.toString('utf8');
        onUpload(blobPath, text);
        return {};
      },
    }) as unknown as BlockBlobClient;

  const getContainerClient = (): ContainerClient =>
    ({ getBlockBlobClient }) as unknown as ContainerClient;

  return { getContainerClient } as unknown as BlobServiceClient;
}
