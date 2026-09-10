import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PUBLISH_ORDER, publishNpmReleases, sortReleasesForPublish } from './publish-npm.mjs';

test('sortReleasesForPublish follows dependency order', () => {
  const sorted = sortReleasesForPublish([
    { name: '@singleton-sd/post-kit-editor' },
    { name: '@singleton-sd/post-kit-types' },
    { name: '@singleton-sd/post-kit-client' },
  ]);
  assert.deepEqual(
    sorted.map((r) => r.name),
    [
      '@singleton-sd/post-kit-types',
      '@singleton-sd/post-kit-client',
      '@singleton-sd/post-kit-editor',
    ],
  );
});

test('PUBLISH_ORDER lists every current public package once', () => {
  assert.equal(new Set(PUBLISH_ORDER).size, PUBLISH_ORDER.length);
  assert.ok(PUBLISH_ORDER.includes('@singleton-sd/post-kit-types'));
  assert.ok(PUBLISH_ORDER.includes('@singleton-sd/post-kit-editor'));
});

test('publishNpmReleases builds then publishes in order', () => {
  /** @type {string[]} */
  const calls = [];
  const run = (file, args, opts = {}) => {
    calls.push(`${file} ${args.join(' ')} @ ${opts.cwd ?? ''}`);
    return '';
  };
  /** @type {string[]} */
  const logs = [];
  const typesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-types-'));
  const editorDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-editor-'));
  fs.writeFileSync(path.join(typesDir, 'package.json'), '{}');
  fs.writeFileSync(path.join(editorDir, 'package.json'), '{}');

  publishNpmReleases(
    [
      { name: '@singleton-sd/post-kit-editor', path: editorDir },
      { name: '@singleton-sd/post-kit-types', path: typesDir },
    ],
    { run, log: (m) => logs.push(m) },
  );

  assert.deepEqual(calls, [
    `pnpm run build @ ${typesDir}`,
    `pnpm publish --access public --no-git-checks @ ${typesDir}`,
    `pnpm run build @ ${editorDir}`,
    `pnpm publish --access public --no-git-checks @ ${editorDir}`,
  ]);
  assert.match(logs.join('\n'), /Publishing/);
});
