import assert from 'node:assert/strict';
import { execFileSync, execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  COMMIT_AND_TAGS_PUSHED_MESSAGE,
  RELEASE_SUBJECT,
  applyCiRelease,
  bumpPackageVersion,
  commitRelease,
  createAndPushTags,
  deriveIncrement,
  nextVersion,
  originUrlPublic,
  originUrlWithToken,
  planPackageRelease,
  pushReleaseCommit,
  reconcileTaggedHead,
  releaseSpecsForTagsAtHead,
  resolveNextVersion,
  takeAndClearAppTokenFromEnv,
  withAuthenticatedOrigin,
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
  assert.equal(
    deriveIncrement(['docs: readme\n', 'chore(release): Release package versions [skip ci]\n']),
    null,
  );
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

test('createAndPushTags pushes HEAD:main and tags atomically', () => {
  /** @type {{ file: string, args: string[] }[]} */
  const calls = [];
  const runFn = (file, args) => {
    calls.push({ file, args });
    if (file === 'git' && args[0] === 'rev-parse') {
      throw new Error('not a tag');
    }
    return '';
  };
  createAndPushTags(['@singleton-sd/post-kit-email@0.6.0'], runFn);
  const push = calls.find((c) => c.args[0] === 'push');
  assert.ok(push);
  assert.deepEqual(push.args, [
    'push',
    '--atomic',
    'origin',
    'HEAD:main',
    'refs/tags/@singleton-sd/post-kit-email@0.6.0:refs/tags/@singleton-sd/post-kit-email@0.6.0',
  ]);
});

test('pushReleaseCommit does not rebase a rejected push', () => {
  /** @type {string[][]} */
  const calls = [];
  assert.throws(() => {
    pushReleaseCommit((_file, args) => {
      calls.push(args);
      throw new Error('non-fast-forward');
    });
  }, /non-fast-forward/);
  assert.deepEqual(calls, [['push', '--atomic', 'origin', 'HEAD:main']]);
  assert.equal(
    calls.some((args) => args.includes('pull') || args.includes('--rebase')),
    false,
  );
});

test('createAndPushTags does not rebase after a rejected atomic push', () => {
  /** @type {string[][]} */
  const calls = [];
  assert.throws(() => {
    createAndPushTags(['@singleton-sd/post-kit-email@0.6.0'], (_file, args) => {
      calls.push(args);
      if (args[0] === 'rev-parse') throw new Error('not a tag');
      if (args[0] === 'push') throw new Error('non-fast-forward');
      return '';
    });
  }, /non-fast-forward/);
  assert.equal(
    calls.some((args) => args.includes('pull') || args.includes('--rebase')),
    false,
  );
});

test('commitRelease uses the skip-ci subject and stages package.json plus CHANGELOG', () => {
  /** @type {string[][]} */
  const calls = [];
  commitRelease(
    [
      {
        name: '@singleton-sd/post-kit-email',
        path: '/tmp/post-kit-email',
        version: '0.5.0',
        next: '0.6.0',
        increment: 'minor',
        tag: '@singleton-sd/post-kit-email@0.6.0',
        previousTag: '@singleton-sd/post-kit-email@0.5.0',
        messages: [],
      },
    ],
    (_file, args) => {
      calls.push(args);
      return '';
    },
  );
  assert.ok(calls.some((args) => args[0] === 'add' && String(args[1]).endsWith('package.json')));
  assert.ok(calls.some((args) => args[0] === 'add' && args[1] === 'CHANGELOG.md'));
  const commit = calls.find((args) => args[0] === 'commit');
  assert.ok(commit);
  assert.equal(commit[1], '-m');
  assert.equal(RELEASE_SUBJECT, 'chore(release): Release package versions [skip ci]');
  assert.equal(commit[2].startsWith(RELEASE_SUBJECT), true);
  assert.match(commit[2], /@singleton-sd\/post-kit-email@0\.6\.0/);
});

test('bumpPackageVersion writes the next version into package.json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'post-kit-bump-'));
  const pkgPath = join(dir, 'package.json');
  writeFileSync(
    pkgPath,
    `${JSON.stringify({ name: '@singleton-sd/post-kit-email', version: '0.5.0' }, null, 2)}\n`,
  );
  try {
    bumpPackageVersion({ path: dir, next: '0.6.0' });
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    assert.equal(pkg.version, '0.6.0');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('applyCiRelease commits, pushes main and tags, then publishes, then creates GitHub Releases', async () => {
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
    updateChangelog: () => {
      steps.push('changelog');
    },
    commitRelease: () => {
      steps.push('commit');
    },
    createAndPushTags: (tags) => {
      steps.push(`push:${tags.join(',')}`);
    },
    authenticatePush: (fn) => fn(),
    ghToken: 'test-app-token',
    publishNpmReleases: async (releases) => {
      steps.push(`publish:${releases.map((r) => r.tag).join(',')}`);
      return { published: [planned.tag], skipped: [] };
    },
    createGitHubReleases: (releases) => {
      steps.push(`gh:${releases.map((r) => r.tag).join(',')}`);
    },
    log: (msg) => logs.push(msg),
  });

  assert.deepEqual(steps, [
    'bump:0.6.0',
    'changelog',
    'commit',
    'push:@singleton-sd/post-kit-email@0.6.0',
    'publish:@singleton-sd/post-kit-email@0.6.0',
    'gh:@singleton-sd/post-kit-email@0.6.0',
  ]);
  assert.ok(logs.includes(COMMIT_AND_TAGS_PUSHED_MESSAGE));
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
      if (args[0] === 'rev-parse' && args[1] === '@singleton-sd/post-kit-email@0.5.0^{commit}') {
        return 'deadbeef';
      }
      return 'other';
    },
  );
  assert.equal(specs.length, 1);
  assert.equal(specs[0].tag, '@singleton-sd/post-kit-email@0.5.0');
  assert.equal(specs[0].next, '0.5.0');
});

test('releaseSpecsForTagsAtHead peels a real annotated tag to HEAD', () => {
  const dir = mkdtempSync(join(tmpdir(), 'post-kit-ann-tag-'));
  const git = (args) =>
    execFileSync('git', args, {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  try {
    execSync('git init', { cwd: dir, stdio: 'ignore' });
    git(['config', 'user.email', 'release-test@example.com']);
    git(['config', 'user.name', 'Release Test']);
    writeFileSync(join(dir, 'README'), 'ok\n');
    git(['add', 'README']);
    git(['commit', '-m', 'init']);
    const head = git(['rev-parse', 'HEAD']);
    const tag = '@singleton-sd/post-kit-email@0.5.0';
    git(['tag', '-a', tag, '-m', tag]);
    const tagObject = git(['rev-parse', tag]);
    assert.notEqual(tagObject, head);
    const specs = releaseSpecsForTagsAtHead(
      [{ name: '@singleton-sd/post-kit-email', path: dir }],
      {
        getLastTag: () => tag,
        getCommitMessages: () => [],
        tagExists: () => true,
      },
      head,
      (_file, args) => git(args),
    );
    assert.equal(specs.length, 1);
    assert.equal(specs[0].tag, tag);
    assert.equal(specs[0].next, '0.5.0');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reconcileTaggedHead publishes missing npm versions and creates GitHub Releases', async () => {
  /** @type {string[]} */
  const steps = [];
  const atHead = await reconcileTaggedHead(
    [{ name: '@singleton-sd/post-kit-email', path: '/tmp/email', version: '0.6.0' }],
    {
      getLastTag: () => '@singleton-sd/post-kit-email@0.6.0',
      getCommitMessages: () => [],
      tagExists: () => true,
    },
    {
      headSha: 'deadbeef',
      run: (_file, args) => {
        if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
          return 'deadbeef';
        }
        if (args[0] === 'rev-parse' && args[1] === '@singleton-sd/post-kit-email@0.6.0^{commit}') {
          return 'deadbeef';
        }
        return 'other';
      },
      publishNpmReleases: async (releases) => {
        steps.push(`publish:${releases.map((r) => r.tag).join(',')}`);
        return { published: releases.map((r) => r.tag), skipped: [] };
      },
      createGitHubReleases: (releases) => {
        steps.push(`gh:${releases.map((r) => r.tag).join(',')}`);
      },
      ghToken: 'test-app-token',
      log: () => {},
    },
  );
  assert.equal(atHead.length, 1);
  assert.deepEqual(steps, [
    'publish:@singleton-sd/post-kit-email@0.6.0',
    'gh:@singleton-sd/post-kit-email@0.6.0',
  ]);
});

test('originUrlWithToken embeds the App token only in the git remote URL', () => {
  assert.equal(
    originUrlWithToken('app-token-secret', 'singleton-sd/post-kit'),
    'https://x-access-token:app-token-secret@github.com/singleton-sd/post-kit.git',
  );
  assert.throws(() => originUrlWithToken('', 'singleton-sd/post-kit'), /RELEASE_APP_TOKEN/);
  assert.throws(() => originUrlWithToken('tok', ''), /GITHUB_REPOSITORY/);
});

test('originUrlPublic is a token-free HTTPS remote', () => {
  assert.equal(
    originUrlPublic('singleton-sd/post-kit'),
    'https://github.com/singleton-sd/post-kit.git',
  );
});

test('withAuthenticatedOrigin authenticates for the push then always resets origin', () => {
  /** @type {string[][]} */
  const calls = [];
  const env = {
    RELEASE_APP_TOKEN: 'app-token-secret',
    GITHUB_REPOSITORY: 'singleton-sd/post-kit',
  };
  withAuthenticatedOrigin(
    () => {
      calls.push(['work']);
    },
    (_file, args) => {
      calls.push(args);
      return '';
    },
    env,
  );
  assert.deepEqual(calls, [
    [
      'remote',
      'set-url',
      'origin',
      'https://x-access-token:app-token-secret@github.com/singleton-sd/post-kit.git',
    ],
    ['work'],
    ['remote', 'set-url', 'origin', 'https://github.com/singleton-sd/post-kit.git'],
  ]);
});

test('withAuthenticatedOrigin resets origin when the push fails', () => {
  /** @type {string[][]} */
  const calls = [];
  const env = {
    RELEASE_APP_TOKEN: 'app-token-secret',
    GITHUB_REPOSITORY: 'singleton-sd/post-kit',
  };
  assert.throws(() => {
    withAuthenticatedOrigin(
      () => {
        throw new Error('non-fast-forward');
      },
      (_file, args) => {
        calls.push(args);
        return '';
      },
      env,
    );
  }, /non-fast-forward/);
  assert.deepEqual(calls.at(-1), [
    'remote',
    'set-url',
    'origin',
    'https://github.com/singleton-sd/post-kit.git',
  ]);
});

test('takeAndClearAppTokenFromEnv strips the App token from process env', () => {
  const env = {
    RELEASE_APP_TOKEN: 'app-token-secret',
    GH_TOKEN: 'app-token-secret',
    GITHUB_TOKEN: 'app-token-secret',
    PATH: '/usr/bin',
  };
  assert.equal(takeAndClearAppTokenFromEnv(env), 'app-token-secret');
  assert.equal('RELEASE_APP_TOKEN' in env, false);
  assert.equal('GH_TOKEN' in env, false);
  assert.equal('GITHUB_TOKEN' in env, false);
  assert.equal(env.PATH, '/usr/bin');
});

test('takeAndClearAppTokenFromEnv keeps a distinct job GITHUB_TOKEN', () => {
  const env = {
    RELEASE_APP_TOKEN: 'app-token-secret',
    GITHUB_TOKEN: 'job-read-token',
  };
  assert.equal(takeAndClearAppTokenFromEnv(env), 'app-token-secret');
  assert.equal(env.GITHUB_TOKEN, 'job-read-token');
});

test('applyCiRelease authenticates the push then clears the App token before publish', async () => {
  /** @type {string[]} */
  const steps = [];
  const env = {
    RELEASE_APP_TOKEN: 'app-token-secret',
    GH_TOKEN: 'app-token-secret',
    GITHUB_REPOSITORY: 'singleton-sd/post-kit',
  };
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

  await applyCiRelease([planned], {
    bumpPackageVersion: () => steps.push('bump'),
    updateChangelog: () => steps.push('changelog'),
    commitRelease: () => steps.push('commit'),
    createAndPushTags: () => {
      assert.equal(env.RELEASE_APP_TOKEN, 'app-token-secret');
      steps.push('push');
    },
    authenticatePush: (fn) => {
      steps.push('auth');
      fn();
      steps.push('reset');
    },
    publishNpmReleases: async () => {
      assert.equal('RELEASE_APP_TOKEN' in env, false);
      assert.equal('GH_TOKEN' in env, false);
      steps.push('publish');
      return { published: [planned.tag], skipped: [] };
    },
    createGitHubReleases: (_releases, options = {}) => {
      assert.equal(options.ghToken, 'app-token-secret');
      steps.push('gh');
    },
    env,
    log: () => {},
  });

  assert.deepEqual(steps, [
    'bump',
    'changelog',
    'commit',
    'auth',
    'push',
    'reset',
    'publish',
    'gh',
  ]);
});

test('release-changed.mjs commits CHANGELOG and pushes HEAD:main', () => {
  const src = readFileSync(new URL('./release-changed.mjs', import.meta.url), 'utf8');
  assert.match(src, /HEAD:main/);
  assert.match(src, /git', \['commit'/);
  assert.match(src, /git', \['add'/);
  assert.match(src, /updateChangelog/);
  assert.match(src, /--atomic/);
  assert.match(src, /chore\(release\): Release package versions \[skip ci\]/);
  assert.match(src, /refs\/tags\//);
  assert.match(src, /\^\{commit\}/);
  assert.match(src, /withAuthenticatedOrigin/);
  assert.match(src, /takeAndClearAppTokenFromEnv/);
  assert.match(src, /x-access-token:\$\{token\}/);
});

test('release.yml uses the singleton-release app, pinned SHAs, and job-level permissions', () => {
  const yml = readFileSync(join(ROOT, '.github/workflows/release.yml'), 'utf8');
  assert.match(yml, /checkout -B main/);
  assert.match(yml, /chore\(release\):/);
  assert.doesNotMatch(yml, /secrets\.NPM_TOKEN|NPM_TOKEN:/);
  assert.match(yml, /Release commit and tags pushed/);
  assert.match(yml, /vars\.RELEASE_APP_ID/);
  assert.match(yml, /secrets\.RELEASE_APP_PRIVATE_KEY/);
  assert.match(yml, /owner:\s*singleton-sd/);
  assert.match(yml, /repositories:\s*post-kit/);
  assert.match(yml, /permission-contents:\s*write/);
  assert.match(yml, /actions\/create-github-app-token@[0-9a-f]{40}/);
  assert.match(yml, /actions\/checkout@[0-9a-f]{40}/);
  assert.match(yml, /pnpm\/action-setup@[0-9a-f]{40}/);
  assert.match(yml, /actions\/setup-node@[0-9a-f]{40}/);
  assert.match(yml, /Never falling back to GITHUB_TOKEN/);
  assert.match(yml, /persist-credentials:\s*false/);
  assert.doesNotMatch(yml, /persist-credentials:\s*true/);
  assert.doesNotMatch(yml, /token:\s*\$\{\{\s*steps\.app-token\.outputs\.token\s*\}\}/);
  assert.doesNotMatch(yml, /GH_TOKEN:\s*\$\{\{\s*steps\.app-token\.outputs\.token\s*\}\}/);
  assert.doesNotMatch(yml, /GITHUB_TOKEN:\s*\$\{\{\s*steps\.app-token\.outputs\.token\s*\}\}/);
  assert.match(yml, /RELEASE_APP_TOKEN:\s*\$\{\{\s*steps\.app-token\.outputs\.token\s*\}\}/);
  assert.match(yml, /APP_SLUG:\s*\$\{\{\s*steps\.app-token\.outputs\.app-slug\s*\}\}/);
  assert.match(yml, /RELEASE_APP_ID:\s*\$\{\{\s*vars\.RELEASE_APP_ID\s*\}\}/);
  assert.match(yml, /\$\{APP_SLUG\}\[bot\]/);
  assert.doesNotMatch(yml, /slug="\$\{\{\s*steps\.app-token\.outputs\.app-slug\s*\}\}"/);
  assert.doesNotMatch(yml, /app_id="\$\{\{\s*vars\.RELEASE_APP_ID\s*\}\}"/);
  assert.doesNotMatch(yml, /x-access-token:\$\{GITHUB_TOKEN\}/);
  assert.doesNotMatch(yml, /secrets\.GITHUB_TOKEN/);
  const tokenStepAt = yml.indexOf('Create GitHub App token');
  const installAt = yml.indexOf('pnpm install --frozen-lockfile');
  const npmUpgradeAt = yml.indexOf('Upgrade npm for OIDC publish');
  const gitIdentityAt = yml.indexOf('Configure git identity');
  const releaseAt = yml.indexOf('Release changed packages');
  assert.ok(tokenStepAt > installAt && tokenStepAt > npmUpgradeAt);
  assert.ok(tokenStepAt < gitIdentityAt && gitIdentityAt < releaseAt);
  assert.match(yml, /startsWith\(github\.event\.head_commit\.message, 'chore\(release\):'\)/);
  assert.doesNotMatch(yml, /github\.actor/);
  const uncommented = yml
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');
  const [workflowLevel, jobLevel] = uncommented.split(/jobs:\s/);
  assert.match(workflowLevel, /permissions:\s*\{\s*\}/);
  assert.doesNotMatch(workflowLevel, /contents:\s*write/);
  assert.doesNotMatch(workflowLevel, /id-token:\s*write/);
  assert.match(jobLevel, /permissions:\s*\n\s+contents:\s*read\s*\n\s+id-token:\s*write/);
  assert.doesNotMatch(jobLevel, /^\s+contents:\s*write\s*$/m);
});
