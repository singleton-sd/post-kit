import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  TAGS_PUSHED_MESSAGE,
  applyCiRelease,
  bindReleaseVersion,
  bumpPackageVersion,
  createAndPushTags,
  deriveIncrement,
  headsMatch,
  nextVersion,
  planPackageRelease,
  releaseSpecsForTagsAtHead,
  resolveNextVersion,
  syncWorkspaceVersionsToTags,
} from './release-changed.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

test('deriveIncrement maps conventional commits to semver bumps', () => {
  assert.equal(deriveIncrement(['fix: handle timeout\n']), 'patch');
  assert.equal(deriveIncrement(['perf: faster parse\n']), 'patch');
  assert.equal(deriveIncrement(['feat: add widget\n']), 'minor');
  assert.equal(deriveIncrement(['feat!: rename send()\n']), 'major');
  assert.equal(
    deriveIncrement(['feat: add widget\n\nBREAKING CHANGE: new request shape\n']),
    'major',
  );
  assert.equal(deriveIncrement(['docs: readme\n', 'chore: Release package versions\n']), null);
});

test('deriveIncrement prefers the highest bump in a batch', () => {
  assert.equal(deriveIncrement(['fix: a\n', 'feat: b\n']), 'minor');
  assert.equal(deriveIncrement(['feat: b\n', 'fix!: c\n']), 'major');
});

test('nextVersion increments from the given base', () => {
  assert.equal(nextVersion('0.5.0', 'patch'), '0.5.1');
  assert.equal(nextVersion('0.5.0', 'minor'), '0.6.0');
  assert.equal(nextVersion('0.5.0', 'major'), '1.0.0');
});

test('resolveNextVersion uses the latest tag, not a stale package.json', () => {
  const resolved = resolveNextVersion(
    '@singleton-sd/post-kit-email',
    '0.4.0',
    '@singleton-sd/post-kit-email@0.5.0',
    'minor',
    () => false,
  );
  assert.equal(resolved.base, '0.5.0');
  assert.equal(resolved.next, '0.6.0');
  assert.equal(resolved.tag, '@singleton-sd/post-kit-email@0.6.0');
});

test('resolveNextVersion skips tag names that already exist', () => {
  const resolved = resolveNextVersion(
    '@singleton-sd/post-kit-email',
    '0.5.0',
    '@singleton-sd/post-kit-email@0.5.0',
    'minor',
    (tag) => tag.endsWith('@0.6.0'),
  );
  assert.equal(resolved.next, '0.7.0');
  assert.equal(resolved.tag, '@singleton-sd/post-kit-email@0.7.0');
});

test('planPackageRelease reads increment from commits since the last tag', () => {
  const planned = planPackageRelease(
    {
      name: '@singleton-sd/post-kit-email',
      path: '/tmp/post-kit-email',
      version: '0.5.0',
    },
    {
      getLastTag: () => '@singleton-sd/post-kit-email@0.5.0',
      getCommitMessages: (tag, paths) => {
        assert.equal(tag, '@singleton-sd/post-kit-email@0.5.0');
        assert.ok(paths.some((p) => p.includes('post-kit-email')));
        return ['feat: expose retry budget\n'];
      },
      tagExists: () => false,
    },
  );
  assert.ok(planned);
  assert.equal(planned.next, '0.6.0');
  assert.equal(planned.increment, 'minor');
  assert.equal(planned.previousTag, '@singleton-sd/post-kit-email@0.5.0');
  assert.equal(planned.tag, '@singleton-sd/post-kit-email@0.6.0');
});

test('planPackageRelease returns null when there is nothing to bump', () => {
  const planned = planPackageRelease(
    {
      name: '@singleton-sd/post-kit-email',
      path: '/tmp/post-kit-email',
      version: '0.5.0',
    },
    {
      getLastTag: () => '@singleton-sd/post-kit-email@0.5.0',
      getCommitMessages: () => ['docs: comment\n'],
      tagExists: () => false,
    },
  );
  assert.equal(planned, null);
});

test('createAndPushTags pushes tag refspecs only', () => {
  /** @type {{ file: string, args: string[] }[]} */
  const calls = [];
  const runFn = (file, args) => {
    calls.push({ file, args });
    if (file === 'git' && args[0] === 'rev-parse') {
      const error = new Error('not a tag');
      throw error;
    }
    return '';
  };
  createAndPushTags(['@singleton-sd/post-kit-email@0.6.0'], runFn);
  const push = calls.find((c) => c.args[0] === 'push');
  assert.ok(push);
  assert.deepEqual(push.args, [
    'push',
    'origin',
    'refs/tags/@singleton-sd/post-kit-email@0.6.0:refs/tags/@singleton-sd/post-kit-email@0.6.0',
  ]);
  assert.equal(
    calls.some((c) => c.args.includes('HEAD:main') || c.args.includes('main')),
    false,
  );
});

test('bumpPackageVersion uses npm version --no-git-tag-version', () => {
  /** @type {{ file: string, args: string[], cwd?: string }[]} */
  const calls = [];
  bumpPackageVersion({ path: '/tmp/pkg', next: '1.2.3' }, (file, args, options = {}) => {
    calls.push({ file, args, cwd: options.cwd });
    return '';
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, 'npm');
  assert.deepEqual(calls[0].args, [
    'version',
    '1.2.3',
    '--no-git-tag-version',
    '--allow-same-version',
  ]);
  assert.equal(calls[0].cwd, '/tmp/pkg');
});

test('applyCiRelease publishes, pushes tags only, then creates GitHub Releases', async () => {
  const planned = {
    name: '@singleton-sd/post-kit-email',
    path: '/tmp/post-kit-email',
    version: '0.5.0',
    next: '0.6.0',
    increment: /** @type {const} */ ('minor'),
    tag: '@singleton-sd/post-kit-email@0.6.0',
    previousTag: '@singleton-sd/post-kit-email@0.5.0',
    messages: ['feat: expose retry budget\n'],
  };
  /** @type {string[]} */
  const steps = [];
  /** @type {string[]} */
  const logs = [];

  await applyCiRelease([planned], {
    bumpPackageVersion: (release) => {
      steps.push(`bump:${release.next}`);
    },
    publishNpmReleases: async (releases) => {
      steps.push(`publish:${releases.map((r) => r.tag).join(',')}`);
      return { published: [planned.tag], skipped: [] };
    },
    createAndPushTags: (tags) => {
      steps.push(`tags:${tags.join(',')}`);
    },
    createGitHubReleases: (releases) => {
      steps.push(`gh:${releases.map((r) => r.tag).join(',')}`);
    },
    fetchNpmMeta: async () => ({ published: false, gitHead: null }),
    tagExists: () => false,
    headSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    log: (msg) => logs.push(msg),
  });

  assert.deepEqual(steps, [
    'bump:0.6.0',
    'publish:@singleton-sd/post-kit-email@0.6.0',
    'tags:@singleton-sd/post-kit-email@0.6.0',
    'gh:@singleton-sd/post-kit-email@0.6.0',
  ]);
  assert.ok(logs.includes(TAGS_PUSHED_MESSAGE));
  assert.equal(
    logs.some((line) => /release commit/i.test(line)),
    false,
  );
});

test('headsMatch compares gitHead prefixes of at least 7 hex chars', () => {
  assert.equal(headsMatch('abcdef1', 'abcdef1ffffffff'), true);
  assert.equal(headsMatch('abcdef1ffffffff', 'abcdef1'), true);
  assert.equal(headsMatch('abcdef2', 'abcdef1ffffffff'), false);
  assert.equal(headsMatch(null, 'abcdef1ffffffff'), false);
});

test('syncWorkspaceVersionsToTags bumps unreleased deps whose tags are ahead', () => {
  /** @type {string[]} */
  const bumped = [];
  syncWorkspaceVersionsToTags(
    [
      { name: '@singleton-sd/post-kit-types', path: '/tmp/types', version: '0.5.0' },
      { name: '@singleton-sd/post-kit-editor', path: '/tmp/editor', version: '0.7.0' },
    ],
    [
      {
        name: '@singleton-sd/post-kit-editor',
        path: '/tmp/editor',
        version: '0.7.0',
        next: '0.8.0',
        increment: 'minor',
        tag: '@singleton-sd/post-kit-editor@0.8.0',
        previousTag: '@singleton-sd/post-kit-editor@0.7.0',
        messages: [],
      },
    ],
    {
      getLastTag: (name) =>
        name === '@singleton-sd/post-kit-types'
          ? '@singleton-sd/post-kit-types@0.6.0'
          : '@singleton-sd/post-kit-editor@0.7.0',
      getCommitMessages: () => [],
      tagExists: () => false,
    },
    (release) => bumped.push(`${release.name}@${release.next}`),
  );
  assert.deepEqual(bumped, ['@singleton-sd/post-kit-types@0.6.0']);
});

test('bindReleaseVersion selects the next increment when npm already has a different commit', async () => {
  const bound = await bindReleaseVersion(
    {
      name: '@singleton-sd/post-kit-email',
      path: '/tmp/email',
      version: '0.5.0',
      next: '0.6.0',
      increment: 'minor',
      tag: '@singleton-sd/post-kit-email@0.6.0',
      previousTag: '@singleton-sd/post-kit-email@0.5.0',
      messages: [],
    },
    {
      fetchNpmMeta: async (_name, version) =>
        version === '0.6.0'
          ? { published: true, gitHead: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }
          : { published: false, gitHead: null },
      tagExists: () => false,
      headSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      log: () => {},
    },
  );
  assert.equal(bound.next, '0.7.0');
  assert.equal(bound.tag, '@singleton-sd/post-kit-email@0.7.0');
  assert.equal(bound.npmAlreadyPublished, false);
});

test('bindReleaseVersion recovers a same-commit skip without republishing', async () => {
  const head = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const bound = await bindReleaseVersion(
    {
      name: '@singleton-sd/post-kit-email',
      path: '/tmp/email',
      version: '0.5.0',
      next: '0.6.0',
      increment: 'minor',
      tag: '@singleton-sd/post-kit-email@0.6.0',
      previousTag: '@singleton-sd/post-kit-email@0.5.0',
      messages: [],
    },
    {
      fetchNpmMeta: async () => ({ published: true, gitHead: head }),
      tagExists: () => false,
      headSha: head,
      log: () => {},
    },
  );
  assert.equal(bound.next, '0.6.0');
  assert.equal(bound.npmAlreadyPublished, true);
});

test('applyCiRelease syncs stale workspace deps then publishes the planned package', async () => {
  /** @type {string[]} */
  const steps = [];
  await applyCiRelease(
    [
      {
        name: '@singleton-sd/post-kit-editor',
        path: '/tmp/editor',
        version: '0.7.0',
        next: '0.8.0',
        increment: 'minor',
        tag: '@singleton-sd/post-kit-editor@0.8.0',
        previousTag: '@singleton-sd/post-kit-editor@0.7.0',
        messages: [],
      },
    ],
    {
      workspacePackages: [
        { name: '@singleton-sd/post-kit-types', path: '/tmp/types', version: '0.5.0' },
        { name: '@singleton-sd/post-kit-editor', path: '/tmp/editor', version: '0.7.0' },
      ],
      git: {
        getLastTag: (name) =>
          name === '@singleton-sd/post-kit-types'
            ? '@singleton-sd/post-kit-types@0.6.0'
            : '@singleton-sd/post-kit-editor@0.7.0',
        getCommitMessages: () => [],
        tagExists: () => false,
      },
      bumpPackageVersion: (release) => {
        steps.push(`bump:${release.name ?? '?'}@${release.next}`);
      },
      publishNpmReleases: async (releases) => {
        steps.push(`publish:${releases.map((r) => r.tag).join(',')}`);
        return { published: ['@singleton-sd/post-kit-editor@0.8.0'], skipped: [] };
      },
      createAndPushTags: (tags) => {
        steps.push(`tags:${tags.join(',')}`);
      },
      createGitHubReleases: () => {
        steps.push('gh');
      },
      fetchNpmMeta: async () => ({ published: false, gitHead: null }),
      tagExists: () => false,
      headSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      log: () => {},
    },
  );
  assert.deepEqual(steps, [
    'bump:@singleton-sd/post-kit-types@0.6.0',
    'bump:@singleton-sd/post-kit-editor@0.8.0',
    'publish:@singleton-sd/post-kit-editor@0.8.0',
    'tags:@singleton-sd/post-kit-editor@0.8.0',
    'gh',
  ]);
});

test('releaseSpecsForTagsAtHead returns last tags that point at HEAD', () => {
  const specs = releaseSpecsForTagsAtHead(
    [{ name: '@singleton-sd/post-kit-email', path: '/tmp/email' }],
    {
      getLastTag: () => '@singleton-sd/post-kit-email@0.5.0',
      getCommitMessages: () => [],
      tagExists: () => true,
    },
    'deadbeef',
    (_file, args) => {
      if (args[0] === 'rev-parse' && args[1] === '@singleton-sd/post-kit-email@0.5.0') {
        return 'deadbeef';
      }
      return 'other';
    },
  );
  assert.equal(specs.length, 1);
  assert.equal(specs[0].tag, '@singleton-sd/post-kit-email@0.5.0');
  assert.equal(specs[0].next, '0.5.0');
});

test('release-changed.mjs never commits or pushes the default branch', () => {
  const src = readFileSync(new URL('./release-changed.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /HEAD:main/);
  assert.doesNotMatch(src, /git', \['commit'/);
  assert.doesNotMatch(src, /git', \['add'/);
  assert.doesNotMatch(src, /updateChangelog/);
  assert.doesNotMatch(src, /pushReleaseCommit/);
  assert.match(src, /--no-git-tag-version/);
  assert.match(src, /refs\/tags\//);
});

test('release.yml is tag-only and keeps Trusted Publishing permissions', () => {
  const yml = readFileSync(join(ROOT, '.github/workflows/release.yml'), 'utf8');
  assert.doesNotMatch(yml, /HEAD:main/);
  assert.doesNotMatch(yml, /checkout -B main/);
  assert.doesNotMatch(yml, /chore: Release/);
  assert.doesNotMatch(yml, /secrets\.NPM_TOKEN|NPM_TOKEN:/);
  assert.match(yml, /id-token:\s*write/);
  assert.match(yml, /contents:\s*write/);
  assert.match(yml, /Release tags pushed/);
  assert.match(yml, /secrets\.GITHUB_TOKEN/);
});
