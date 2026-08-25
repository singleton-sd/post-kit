import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createGitHubReleases,
  formatReleaseNotes,
  formatReleaseTitle,
  githubReleaseExists,
} from './github-releases.mjs';

/** @type {import('./github-releases.mjs').ReleaseSpec} */
const sample = {
  name: '@singleton-sd/post-kit-publisher',
  version: '0.1.0',
  next: '0.2.0',
  increment: 'minor',
  tag: '@singleton-sd/post-kit-publisher@0.2.0',
};

test('formatReleaseTitle uses name@version', () => {
  assert.equal(formatReleaseTitle(sample), '@singleton-sd/post-kit-publisher@0.2.0');
});

test('formatReleaseNotes includes bump and npm-disabled note', () => {
  const notes = formatReleaseNotes(sample);
  assert.match(notes, /0\.1\.0.*→.*0\.2\.0.*minor/);
  assert.match(notes, /CHANGELOG\.md/);
  assert.match(notes, /npm publish is not enabled/);
});

test('githubReleaseExists is true when gh release view succeeds', () => {
  const runGh = () => '{"tagName":"@singleton-sd/post-kit-publisher@0.2.0"}';
  assert.equal(githubReleaseExists(runGh, sample.tag), true);
});

test('githubReleaseExists is false when gh release view fails', () => {
  const runGh = () => {
    throw new Error('not found');
  };
  assert.equal(githubReleaseExists(runGh, sample.tag), false);
});

test('createGitHubReleases creates missing releases and skips existing', () => {
  /** @type {string[][]} */
  const calls = [];
  const existing = new Set(['@singleton-sd/post-kit-types@0.2.0']);

  const runGh = (/** @type {string[]} */ args) => {
    calls.push(args);
    if (args[0] === 'release' && args[1] === 'view') {
      if (existing.has(args[2])) return JSON.stringify({ tagName: args[2] });
      throw new Error('HTTP 404');
    }
    if (args[0] === 'release' && args[1] === 'create') {
      return '';
    }
    throw new Error(`unexpected gh args: ${args.join(' ')}`);
  };

  /** @type {string[]} */
  const logs = [];
  const result = createGitHubReleases(
    [
      sample,
      {
        name: '@singleton-sd/post-kit-types',
        version: '0.1.0',
        next: '0.2.0',
        increment: 'minor',
        tag: '@singleton-sd/post-kit-types@0.2.0',
      },
    ],
    { runGh, log: (m) => logs.push(m) },
  );

  assert.deepEqual(result.created, ['@singleton-sd/post-kit-publisher@0.2.0']);
  assert.deepEqual(result.skipped, ['@singleton-sd/post-kit-types@0.2.0']);

  const createCall = calls.find((a) => a[1] === 'create');
  assert.ok(createCall);
  assert.equal(createCall[2], sample.tag);
  assert.equal(createCall[createCall.indexOf('--title') + 1], sample.tag);
  assert.match(createCall[createCall.indexOf('--notes') + 1], /0\.1\.0.*→.*0\.2\.0/);
  assert.match(logs.join('\n'), /Created GitHub Release/);
  assert.match(logs.join('\n'), /already exists/);
});
