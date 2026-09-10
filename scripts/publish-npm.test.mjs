import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  PUBLISH_ORDER,
  isVersionOnNpm,
  npmVersionRegistryUrl,
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

test('npmVersionRegistryUrl encodes the scoped name', () => {
  assert.equal(
    npmVersionRegistryUrl('@singleton-sd/post-kit-types', '0.3.0'),
    'https://registry.npmjs.org/%40singleton-sd%2Fpost-kit-types/0.3.0',
  );
});

test('isVersionOnNpm is true on HTTP 200', async () => {
  const fetchImpl = async () => ({ status: 200 });
  assert.equal(await isVersionOnNpm('@singleton-sd/post-kit-types', '0.3.0', { fetchImpl }), true);
});

test('isVersionOnNpm is false on HTTP 404', async () => {
  const fetchImpl = async () => ({ status: 404 });
  assert.equal(await isVersionOnNpm('@singleton-sd/post-kit-types', '0.3.0', { fetchImpl }), false);
});

test('isVersionOnNpm throws on network failure (does not treat as unpublished)', async () => {
  const fetchImpl = async () => {
    throw new Error('ECONNRESET');
  };
  await assert.rejects(
    () => isVersionOnNpm('@singleton-sd/post-kit-types', '0.3.0', { fetchImpl }),
    /Failed to reach npm registry/,
  );
});

test('isVersionOnNpm throws on unexpected status', async () => {
  const fetchImpl = async () => ({ status: 503 });
  await assert.rejects(
    () => isVersionOnNpm('@singleton-sd/post-kit-types', '0.3.0', { fetchImpl }),
    /Unexpected npm registry status 503/,
  );
});

test('publishNpmReleases skips versions already on npmjs', async () => {
  /** @type {string[]} */
  const calls = [];
  const run = (file, args, opts = {}) => {
    calls.push(`${file} ${args.join(' ')} @ ${opts.cwd ?? ''}`);
    return '';
  };
  const fetchImpl = async (url) => {
    if (String(url).includes('post-kit-types') && String(url).includes('0.3.0')) {
      return { status: 200 };
    }
    return { status: 404 };
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

  const result = await publishNpmReleases(
    [
      { name: '@singleton-sd/post-kit-editor', path: editorDir, next: '0.3.0' },
      { name: '@singleton-sd/post-kit-types', path: typesDir, next: '0.3.0' },
    ],
    { run, log: (m) => logs.push(m), fetchImpl },
  );

  assert.deepEqual(result.skipped, ['@singleton-sd/post-kit-types@0.3.0']);
  assert.deepEqual(result.published, ['@singleton-sd/post-kit-editor@0.3.0']);
  assert.ok(calls.some((c) => c.includes('pnpm publish') && c.includes(editorDir)));
  assert.ok(!calls.some((c) => c.includes('pnpm publish') && c.includes(typesDir)));
  assert.match(logs.join('\n'), /Skipping @singleton-sd\/post-kit-types@0\.3\.0/);
});
