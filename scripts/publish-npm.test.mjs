import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  PUBLISH_ORDER,
  isVersionOnNpm,
  publishNpmReleases,
  sortReleasesForPublish,
} from './publish-npm.mjs';

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

test('isVersionOnNpm is true when npm view returns the version', () => {
  const run = () => '0.3.0';
  assert.equal(isVersionOnNpm('@singleton-sd/post-kit-types', '0.3.0', { run }), true);
});

test('isVersionOnNpm is false when npm view fails', () => {
  const run = () => {
    throw new Error('404');
  };
  assert.equal(isVersionOnNpm('@singleton-sd/post-kit-types', '0.3.0', { run }), false);
});

test('publishNpmReleases skips versions already on npmjs', () => {
  /** @type {string[]} */
  const calls = [];
  const run = (file, args, opts = {}) => {
    calls.push(`${file} ${args.join(' ')} @ ${opts.cwd ?? ''}`);
    if (file === 'npm' && args[0] === 'view') {
      if (String(args[1]).includes('post-kit-types@0.3.0')) return '0.3.0';
      throw new Error('404 Not Found');
    }
    return '';
  };
  /** @type {string[]} */
  const logs = [];
  const typesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-types-'));
  const editorDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-editor-'));
  fs.writeFileSync(
    path.join(typesDir, 'package.json'),
    JSON.stringify({ name: '@singleton-sd/post-kit-types', version: '0.3.0' }),
  );
  fs.writeFileSync(
    path.join(editorDir, 'package.json'),
    JSON.stringify({ name: '@singleton-sd/post-kit-editor', version: '0.3.0' }),
  );

  const result = publishNpmReleases(
    [
      { name: '@singleton-sd/post-kit-editor', path: editorDir, next: '0.3.0' },
      { name: '@singleton-sd/post-kit-types', path: typesDir, next: '0.3.0' },
    ],
    { run, log: (m) => logs.push(m) },
  );

  assert.deepEqual(result.skipped, ['@singleton-sd/post-kit-types@0.3.0']);
  assert.deepEqual(result.published, ['@singleton-sd/post-kit-editor@0.3.0']);
  assert.ok(calls.some((c) => c.includes('pnpm publish') && c.includes(editorDir)));
  assert.ok(!calls.some((c) => c.includes('pnpm publish') && c.includes(typesDir)));
  assert.match(logs.join('\n'), /Skipping @singleton-sd\/post-kit-types@0\.3\.0/);
});
