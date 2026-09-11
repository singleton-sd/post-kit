import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { serializeTemplateSource } from '@singleton-sd/post-kit-editor';
import { createFsTemplateStore } from './template-store';
import { toFsOnSave } from './save-stub';

const CONTENT_ROOT = fileURLToPath(new URL('../content/email-templates', import.meta.url));

describe('toFsOnSave', () => {
  it('writes files and logs the PR reminder', () => {
    const root = mkdtempSync(join(tmpdir(), 'pk-admin-save-'));
    after(() => rmSync(root, { recursive: true, force: true }));

    const seedDir = join(root, 'demo.welcome');
    mkdirSync(seedDir);
    for (const name of ['template.json', 'metadata.json', 'preview.json'] as const) {
      writeFileSync(
        join(seedDir, name),
        readFileSync(join(CONTENT_ROOT, 'demo.welcome', name), 'utf8'),
      );
    }

    const messages: string[] = [];
    const store = createFsTemplateStore(root);
    const onSave = toFsOnSave(
      store,
      (key) => key,
      (m) => messages.push(m),
    );
    const files = store.load('demo.welcome');
    const result = onSave(serializeTemplateSource(files), files);

    assert.equal(result.ok, true);
    assert.equal(messages.length, 1);
    assert.match(messages[0]!, /post-kit-publish/);
  });
});
