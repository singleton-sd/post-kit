import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { serializeTemplateSource } from '@singleton-sd/post-kit-editor';
import { assertSafeDirectory, createFsTemplateStore } from './template-store';

const CONTENT_ROOT = fileURLToPath(new URL('../content/email-templates', import.meta.url));

describe('assertSafeDirectory', () => {
  it('rejects traversal and empty names', () => {
    assert.throws(() => assertSafeDirectory(''), /Invalid/);
    assert.throws(() => assertSafeDirectory('..'), /Invalid/);
    assert.throws(() => assertSafeDirectory('a/b'), /Invalid/);
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

  it('saves a round-trip into a temp directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'pk-admin-store-'));
    after(() => rmSync(root, { recursive: true, force: true }));

    const seedDir = join(root, 'demo.welcome');
    mkdirSync(seedDir);
    for (const name of ['template.json', 'metadata.json', 'preview.json'] as const) {
      writeFileSync(
        join(seedDir, name),
        readFileSync(join(CONTENT_ROOT, 'demo.welcome', name), 'utf8'),
      );
    }

    const store = createFsTemplateStore(root);
    const files = store.load('demo.welcome');
    const serialized = serializeTemplateSource(files);
    const result = store.save('demo.welcome', serialized, files);
    assert.equal(result.ok, true);
    const reloaded = store.load('demo.welcome');
    assert.equal(reloaded.metadata.key, 'demo.welcome');
  });
});
