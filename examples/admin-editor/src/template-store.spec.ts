import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { serializeTemplateSource } from '@singleton-sd/post-kit-editor';
import { assertSafeDirectory, createFsTemplateStore } from './template-store';

const CONTENT_ROOT = fileURLToPath(new URL('../content/email-templates', import.meta.url));

function seedDemoWelcome(root: string): void {
  const seedDir = join(root, 'demo.welcome');
  mkdirSync(seedDir);
  for (const name of ['template.json', 'metadata.json', 'preview.json'] as const) {
    writeFileSync(
      join(seedDir, name),
      readFileSync(join(CONTENT_ROOT, 'demo.welcome', name), 'utf8'),
    );
  }
}

describe('assertSafeDirectory', () => {
  it('rejects traversal and empty names', () => {
    assert.throws(() => assertSafeDirectory(''), /Invalid/);
    assert.throws(() => assertSafeDirectory('..'), /Invalid/);
    assert.throws(() => assertSafeDirectory('a/b'), /Invalid/);
  });

  it('rejects dot-prefixed directory names', () => {
    assert.throws(() => assertSafeDirectory('.draft'), /Invalid/);
    assert.throws(() => assertSafeDirectory('.demo.welcome-staging-xyz'), /Invalid/);
  });
});

describe('createFsTemplateStore', () => {
  it('lists seeded example templates', () => {
    const store = createFsTemplateStore(CONTENT_ROOT);
    const items = store.list();
    const keys = items.map((i) => i.key).sort();
    assert.deepEqual(keys, ['auth.password-reset', 'demo.welcome']);
  });

  it('loads demo.welcome sources', () => {
    const store = createFsTemplateStore(CONTENT_ROOT);
    const files = store.load('demo.welcome');
    assert.equal(files.metadata.key, 'demo.welcome');
    assert.ok(files.previewData['name']);
  });

  it('saves changed content into a temp directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'pk-admin-store-'));
    after(() => rmSync(root, { recursive: true, force: true }));
    seedDemoWelcome(root);

    const store = createFsTemplateStore(root);
    const files = store.load('demo.welcome');
    const next = {
      ...files,
      metadata: { ...files.metadata, name: 'Welcome (persisted)' },
      previewData: { ...files.previewData, name: 'Persisted Name' },
    };
    const result = store.save('demo.welcome', serializeTemplateSource(next), next);
    assert.equal(result.ok, true);
    const reloaded = store.load('demo.welcome');
    assert.equal(reloaded.metadata.key, 'demo.welcome');
    assert.equal(reloaded.metadata.name, 'Welcome (persisted)');
    assert.equal(reloaded.previewData['name'], 'Persisted Name');
  });

  it('leaves original files unchanged when a later staged write fails', () => {
    const root = mkdtempSync(join(tmpdir(), 'pk-admin-store-fail-'));
    after(() => rmSync(root, { recursive: true, force: true }));
    seedDemoWelcome(root);

    const originalPreview = readFileSync(join(root, 'demo.welcome', 'preview.json'), 'utf8');
    const originalMeta = readFileSync(join(root, 'demo.welcome', 'metadata.json'), 'utf8');

    const store = createFsTemplateStore(root, {
      writeFileSync(path, data, options) {
        if (String(path).endsWith('preview.json')) {
          throw new Error('simulated preview write failure');
        }
        return writeFileSync(path, data, options);
      },
    });

    const files = store.load('demo.welcome');
    const next = {
      ...files,
      metadata: { ...files.metadata, name: 'Should not land' },
    };
    const result = store.save('demo.welcome', serializeTemplateSource(next), next);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.message ?? '', /simulated preview write failure/);
    }

    assert.equal(readFileSync(join(root, 'demo.welcome', 'preview.json'), 'utf8'), originalPreview);
    assert.equal(readFileSync(join(root, 'demo.welcome', 'metadata.json'), 'utf8'), originalMeta);
    assert.equal(store.load('demo.welcome').metadata.name, files.metadata.name);
  });

  it('rejects saving under a dot-prefixed directory name', () => {
    const root = mkdtempSync(join(tmpdir(), 'pk-admin-store-dot-'));
    after(() => rmSync(root, { recursive: true, force: true }));
    seedDemoWelcome(root);

    const store = createFsTemplateStore(root);
    const files = store.load('demo.welcome');
    const next = {
      ...files,
      metadata: { ...files.metadata, key: '.draft', name: 'Hidden draft' },
    };
    const result = store.save('.draft', serializeTemplateSource(next), next);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.message ?? '', /Invalid/);
    }
    assert.deepEqual(
      store.list().map((i) => i.directory),
      ['demo.welcome'],
    );
  });

  it('returns ok:false when staging directory creation fails', () => {
    const root = mkdtempSync(join(tmpdir(), 'pk-admin-store-stage-'));
    after(() => rmSync(root, { recursive: true, force: true }));
    seedDemoWelcome(root);

    const store = createFsTemplateStore(root, {
      mkdtempSync() {
        throw new Error('simulated mkdtemp failure');
      },
    });
    const files = store.load('demo.welcome');
    const next = {
      ...files,
      metadata: { ...files.metadata, name: 'Should not land' },
    };
    const result = store.save('demo.welcome', serializeTemplateSource(next), next);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.message ?? '', /simulated mkdtemp failure/);
    }
    assert.equal(store.load('demo.welcome').metadata.name, files.metadata.name);
  });

  it('preserves the original save error when cleanup also fails', () => {
    const root = mkdtempSync(join(tmpdir(), 'pk-admin-store-cleanup-'));
    after(() => rmSync(root, { recursive: true, force: true }));
    seedDemoWelcome(root);

    const store = createFsTemplateStore(root, {
      writeFileSync(path, data, options) {
        if (String(path).endsWith('preview.json')) {
          throw new Error('simulated preview write failure');
        }
        return writeFileSync(path, data, options);
      },
      rmSync() {
        throw new Error('simulated cleanup failure');
      },
    });
    const files = store.load('demo.welcome');
    const next = {
      ...files,
      metadata: { ...files.metadata, name: 'Should not land' },
    };
    const result = store.save('demo.welcome', serializeTemplateSource(next), next);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.message ?? '', /simulated preview write failure/);
      assert.doesNotMatch(result.message ?? '', /cleanup failure/);
    }
  });
});
