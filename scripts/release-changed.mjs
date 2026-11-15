#!/usr/bin/env node
/**
 * Path-aware independent releases for the pnpm monorepo.
 *
 * Bumps each `@singleton-sd/post-kit-*` workspace package that has releasable
 * conventional commits since its last reachable `@scope/name@version` tag,
 * updates CHANGELOG.md, commits `chore(release): Release package versions [skip ci]`,
 * pushes that commit to `main` plus annotated tags, then publishes to npmjs
 * via Trusted Publishing (OIDC) and creates GitHub Releases.
 *
 * Push order is commit-and-tags first, then npm publish, then GitHub Releases:
 * a later retry cannot bind an already-published version to a newer HEAD.
 * Committed package.json versions are what `pnpm publish` uses to rewrite
 * `workspace:*`.
 *
 * Usage:
 *   node scripts/release-changed.mjs           # dry-run
 *   node scripts/release-changed.mjs --ci      # bump, commit, push, publish, GitHub Releases
 */
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import semver from 'semver';
import { createGitHubReleases } from './github-releases.mjs';
import { publishNpmReleases } from './publish-npm.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const CI = process.argv.includes('--ci');
const PACKAGE_PREFIX = '@singleton-sd/post-kit-';
export const RELEASE_SUBJECT = 'chore(release): Release package versions [skip ci]';
export const COMMIT_AND_TAGS_PUSHED_MESSAGE = 'Release commit and tags pushed.';
export const NOTHING_TO_RELEASE_MESSAGE = 'Nothing to release.';
export const RELEASE_APP_TOKEN_ENV = 'RELEASE_APP_TOKEN';

/** @typedef {'major' | 'minor' | 'patch'} Increment */

/**
 * @typedef {{
 *   name: string,
 *   path: string,
 *   version: string,
 *   next: string,
 *   increment: Increment,
 *   tag: string,
 *   previousTag: string | null,
 *   messages: string[],
 * }} ReleasePlan
 */

/**
 * @typedef {{
 *   getLastTag: (packageName: string) => string | null,
 *   getCommitMessages: (sinceTag: string | null, paths: string[]) => string[],
 *   tagExists: (tag: string) => boolean,
 * }} GitLookup
 */

/**
 * @param {string} command
 * @param {import('node:child_process').ExecSyncOptions} [options]
 */
function sh(command, options = {}) {
  const out = execSync(command, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
  return typeof out === 'string' ? out.trim() : '';
}

/**
 * @param {string} file
 * @param {string[]} args
 * @param {import('node:child_process').ExecFileSyncOptions} [options]
 */
function run(file, args, options = {}) {
  return execFileSync(file, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim();
}

/**
 * @returns {{ name: string, path: string, version: string }[]}
 */
function listWorkspacePackages() {
  const raw = sh('pnpm m ls --json -r --depth -1');
  /** @type {unknown} */
  const parsed = JSON.parse(raw || '[]');
  const list = Array.isArray(parsed) ? parsed : [parsed];
  return list
    .filter(
      (pkg) =>
        pkg &&
        typeof pkg === 'object' &&
        'name' in pkg &&
        typeof pkg.name === 'string' &&
        pkg.name.startsWith(PACKAGE_PREFIX) &&
        'path' in pkg &&
        typeof pkg.path === 'string',
    )
    .map((pkg) => {
      const pkgJsonPath = join(pkg.path, 'package.json');
      const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
      return {
        name: pkg.name,
        path: pkg.path,
        version: typeof pkgJson.version === 'string' ? pkgJson.version : '0.0.0',
        private: pkgJson.private === true,
      };
    })
    .filter((pkg) => !pkg.private);
}

/**
 * True when `ref` is an ancestor of HEAD (tag commit is on this branch history).
 * @param {string} ref
 */
function isAncestorOfHead(ref) {
  try {
    run('git', ['merge-base', '--is-ancestor', ref, 'HEAD']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Highest semver tag for the package that is reachable from HEAD.
 * @param {string} packageName
 * @returns {string | null}
 */
function getLastTag(packageName) {
  const tags = sh(`git tag -l "${packageName}@*" --sort=-v:refname`)
    .split('\n')
    .map((t) => t.trim())
    .filter(Boolean);
  for (const tag of tags) {
    if (isAncestorOfHead(tag)) return tag;
  }
  return null;
}

/**
 * @param {string} packageName
 * @param {string | null} tag
 * @returns {string | null}
 */
export function versionFromTag(packageName, tag) {
  if (!tag) return null;
  const prefix = `${packageName}@`;
  if (!tag.startsWith(prefix)) return null;
  const version = tag.slice(prefix.length);
  return semver.valid(version) ? version : null;
}

/**
 * @param {string} tag
 */
function tagExists(tag) {
  try {
    run('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Paths whose commits should count toward a package bump.
 * @param {{ name: string, path: string }} pkg
 * @returns {string[]}
 */
export function watchPathsFor(pkg) {
  const rel = relative(ROOT, pkg.path).replace(/\\/g, '/');
  return [rel];
}

/**
 * @param {string | null} sinceTag
 * @param {string[]} paths
 * @returns {string[]}
 */
function getCommitMessages(sinceTag, paths) {
  const range = sinceTag ? `${sinceTag}..HEAD` : 'HEAD';
  const args = ['log', range, '--format=%B%x1e', '--'];
  args.push(...paths);
  try {
    const out = run('git', args);
    if (!out) return [];
    return out
      .split('\x1e')
      .map((m) => m.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * @param {string[]} messages
 * @returns {Increment | null}
 */
export function deriveIncrement(messages) {
  /** @type {Increment | null} */
  let bump = null;
  const rank = { patch: 1, minor: 2, major: 3 };

  for (const message of messages) {
    const subject = message.split('\n')[0] ?? '';
    if (subject.startsWith('chore(release):') || subject.startsWith('chore: Release')) {
      continue;
    }

    const lower = message.toLowerCase();
    if (
      /^breaking change:/m.test(lower) ||
      /^(feat|fix|perf|refactor)(\([^)]*\))?!:/m.test(message)
    ) {
      bump = 'major';
      break;
    }

    if (/^feat(\([^)]*\))?:/m.test(message)) {
      if (!bump || rank.minor > rank[bump]) bump = 'minor';
      continue;
    }

    if (/^(fix|perf)(\([^)]*\))?:/m.test(message)) {
      if (!bump || rank.patch > rank[bump]) bump = 'patch';
    }
  }

  return bump;
}

/**
 * @param {string} current
 * @param {Increment} increment
 */
export function nextVersion(current, increment) {
  const base = semver.valid(current) ? current : '0.0.0';
  const next = semver.inc(base, increment);
  if (!next) {
    throw new Error(`Failed to bump ${current} with ${increment}`);
  }
  return next;
}

/**
 * Max of package.json version and last reachable tag, then bump until the
 * target tag name is free (skips orphaned remote tags).
 * @param {string} packageName
 * @param {string} packageVersion
 * @param {string | null} lastTag
 * @param {Increment} increment
 * @param {(tag: string) => boolean} [tagExistsFn]
 * @returns {{ base: string, next: string, tag: string }}
 */
export function resolveNextVersion(
  packageName,
  packageVersion,
  lastTag,
  increment,
  tagExistsFn = tagExists,
) {
  const tagVersion = versionFromTag(packageName, lastTag);
  const candidates = [packageVersion, tagVersion].filter(
    (v) => typeof v === 'string' && Boolean(semver.valid(v)),
  );
  let base = candidates.length > 0 ? candidates.sort(semver.rcompare)[0] : '0.0.0';

  const from = base;

  for (let i = 0; i < 50; i += 1) {
    const next = nextVersion(base, increment);
    const tag = `${packageName}@${next}`;
    if (!tagExistsFn(tag)) {
      return { base: from, next, tag };
    }
    console.warn(`Tag ${tag} already exists — skipping to next ${increment}.`);
    base = next;
  }

  throw new Error(`Could not find a free version for ${packageName} after ${base}`);
}

/**
 * Last-tag GitHub Releases that point at HEAD (retry after a tag push that
 * never created the Release, or an npm publish that never ran).
 *
 * @param {{ name: string, path: string }[]} packages
 * @param {GitLookup} git
 * @param {string} headSha
 * @param {(file: string, args: string[]) => string} runFn
 * @returns {ReleasePlan[]}
 */
export function releaseSpecsForTagsAtHead(packages, git, headSha, runFn) {
  /** @type {ReleasePlan[]} */
  const specs = [];
  for (const pkg of packages) {
    const lastTag = git.getLastTag(pkg.name);
    if (!lastTag) continue;
    let tagged;
    try {
      // Peel annotated tags to the commit they point at (`tag^{commit}`).
      // `git rev-parse <tag>` returns the tag object id for `git tag -a`.
      tagged = runFn('git', ['rev-parse', `${lastTag}^{commit}`]);
    } catch {
      continue;
    }
    if (tagged !== headSha) continue;
    const version = versionFromTag(pkg.name, lastTag);
    if (!version) continue;
    specs.push({
      name: pkg.name,
      path: pkg.path,
      version,
      next: version,
      increment: 'patch',
      tag: lastTag,
      previousTag: null,
      messages: [],
    });
  }
  return specs;
}

/**
 * @param {{ name: string, path: string, version: string }} pkg
 * @param {GitLookup} git
 * @returns {ReleasePlan | null}
 */
export function planPackageRelease(pkg, git) {
  const lastTag = git.getLastTag(pkg.name);
  const paths = watchPathsFor(pkg);
  const messages = git.getCommitMessages(lastTag, paths);
  const increment = deriveIncrement(messages);
  if (!increment) return null;

  const resolved = resolveNextVersion(pkg.name, pkg.version, lastTag, increment, git.tagExists);
  return {
    name: pkg.name,
    path: pkg.path,
    version: resolved.base,
    next: resolved.next,
    increment,
    tag: resolved.tag,
    previousTag: lastTag,
    messages,
  };
}

/**
 * @param {{ name: string, version: string, next: string, increment: Increment }[]} releases
 * @param {string} [changelogPath]
 * @param {() => string} [today]
 */
export function updateChangelog(
  releases,
  changelogPath = join(ROOT, 'CHANGELOG.md'),
  today = () => new Date().toISOString().slice(0, 10),
) {
  const date = today();
  const section = [
    `## ${date}`,
    '',
    ...releases.map((r) => `- **${r.name}** \`${r.version}\` → \`${r.next}\` (${r.increment})`),
    '',
  ].join('\n');

  if (existsSync(changelogPath)) {
    const existing = readFileSync(changelogPath, 'utf8');
    const withoutHeader = existing.replace(/^# Changelog\r?\n\r?\n?/, '');
    writeFileSync(changelogPath, `# Changelog\n\n${section}${withoutHeader}`);
  } else {
    writeFileSync(changelogPath, `# Changelog\n\n${section}`);
  }
}

/**
 * Write the computed next version into package.json. Not a git commit.
 * @param {{ path: string, next: string }} release
 */
export function bumpPackageVersion(release) {
  const pkgJsonPath = join(release.path, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
  pkg.version = release.next;
  writeFileSync(pkgJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);
}

/**
 * @param {ReleasePlan[]} releases
 * @param {typeof run} [runFn]
 */
export function commitRelease(releases, runFn = run) {
  for (const release of releases) {
    runFn('git', ['add', join(release.path, 'package.json')]);
  }
  runFn('git', ['add', 'CHANGELOG.md']);
  const body = releases.map((r) => `- ${r.tag}`).join('\n');
  const message = `${RELEASE_SUBJECT}\n\n${body}\n`;
  runFn('git', ['commit', '-m', message], {
    env: { ...process.env, HUSKY: '0' },
  });
}

/**
 * @param {string} token
 * @param {string} repository
 * @returns {string}
 */
export function originUrlWithToken(token, repository) {
  if (!token) {
    throw new Error(
      'RELEASE_APP_TOKEN is required to push to main. Never falling back to GITHUB_TOKEN.',
    );
  }
  if (!repository) {
    throw new Error('GITHUB_REPOSITORY is required to push to main.');
  }
  return `https://x-access-token:${token}@github.com/${repository}.git`;
}

/**
 * @param {string} repository
 * @returns {string}
 */
export function originUrlPublic(repository) {
  if (!repository) {
    throw new Error('GITHUB_REPOSITORY is required to reset the origin remote.');
  }
  return `https://github.com/${repository}.git`;
}

/**
 * Authenticate origin for `fn`, then always restore a token-free remote so
 * later `pnpm build` / `pnpm publish` cannot observe the App token in git config.
 *
 * @template T
 * @param {() => T} fn
 * @param {typeof run} [runFn]
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {T}
 */
export function withAuthenticatedOrigin(fn, runFn = run, env = process.env) {
  const token = env[RELEASE_APP_TOKEN_ENV];
  const repository = env.GITHUB_REPOSITORY ?? '';
  runFn('git', ['remote', 'set-url', 'origin', originUrlWithToken(token ?? '', repository)]);
  try {
    return fn();
  } finally {
    runFn('git', ['remote', 'set-url', 'origin', originUrlPublic(repository)]);
  }
}

/**
 * Remove the App token from `env` after the git push. Returns it so `gh release`
 * can receive it as GH_TOKEN on that subprocess only.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function takeAndClearAppTokenFromEnv(env = process.env) {
  const token = env[RELEASE_APP_TOKEN_ENV] ?? '';
  delete env[RELEASE_APP_TOKEN_ENV];
  delete env.GH_TOKEN;
  if (token && env.GITHUB_TOKEN === token) {
    delete env.GITHUB_TOKEN;
  }
  return token;
}

/**
 * Sync to origin/main before computing bumps so concurrent pushes do not
 * release from a stale tip.
 */
function syncToOriginMain() {
  run('git', ['fetch', 'origin', 'main', '--tags']);
  const head = run('git', ['rev-parse', 'HEAD']);
  const main = run('git', ['rev-parse', 'origin/main']);
  if (head === main) return;
  console.log(`Updating HEAD ${head.slice(0, 7)} → origin/main ${main.slice(0, 7)}`);
  run('git', ['reset', '--hard', 'origin/main']);
}

/**
 * Push the release commit only. Fails closed on a non-fast-forward: rebasing
 * would keep a stale plan and could tag a later breaking commit as the
 * already-chosen version. A later Release run re-plans from the new tip.
 * @param {typeof run} [runFn]
 */
export function pushReleaseCommit(runFn = run) {
  runFn('git', ['push', '--atomic', 'origin', 'HEAD:main']);
}

/**
 * Create annotated tags for the current HEAD and push them with the release
 * commit in one `--atomic` update. Never `--follow-tags`: that can accept
 * tags while rejecting a non-fast-forward main update. Never rebase a
 * rejected push: the next run must re-plan.
 * @param {string[]} tags
 * @param {typeof run} [runFn]
 */
export function createAndPushTags(tags, runFn = run) {
  for (const tag of tags) {
    try {
      runFn('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`]);
      runFn('git', ['tag', '-d', tag]);
    } catch {
      // Tag is not local yet.
    }
    runFn('git', ['tag', '-a', tag, '-m', tag]);
  }
  const refspecs = tags.map((tag) => `refs/tags/${tag}:refs/tags/${tag}`);
  runFn('git', ['push', '--atomic', 'origin', 'HEAD:main', ...refspecs]);
}

/**
 * @param {ReleasePlan[]} releases
 * @param {{
 *   bumpPackageVersion?: (release: { name?: string, path: string, next: string }) => void,
 *   updateChangelog?: (releases: ReleasePlan[]) => void,
 *   commitRelease?: (releases: ReleasePlan[]) => void,
 *   createAndPushTags?: (tags: string[]) => void,
 *   authenticatePush?: (fn: () => void) => void,
 *   publishNpmReleases?: (releases: ReleasePlan[]) => Promise<{ published: string[], skipped: string[] }>,
 *   createGitHubReleases?: (releases: ReleasePlan[], options?: { ghToken?: string }) => void,
 *   ghToken?: string,
 *   env?: NodeJS.ProcessEnv,
 *   log?: (msg: string) => void,
 * }} [deps]
 */
export async function applyCiRelease(releases, deps = {}) {
  const bump = deps.bumpPackageVersion ?? bumpPackageVersion;
  const changelog = deps.updateChangelog ?? updateChangelog;
  const commit = deps.commitRelease ?? commitRelease;
  const pushTags = deps.createAndPushTags ?? createAndPushTags;
  const publish = deps.publishNpmReleases ?? publishNpmReleases;
  const publishReleases = deps.createGitHubReleases ?? createGitHubReleases;
  const log = deps.log ?? console.log;
  const env = deps.env ?? process.env;
  const authenticatePush = deps.authenticatePush ?? ((fn) => withAuthenticatedOrigin(fn, run, env));

  for (const release of releases) {
    bump(release);
  }
  changelog(releases);
  commit(releases);
  authenticatePush(() => {
    pushTags(releases.map((r) => r.tag));
  });
  log(COMMIT_AND_TAGS_PUSHED_MESSAGE);

  const ghToken = deps.ghToken ?? takeAndClearAppTokenFromEnv(env);

  const npmResult = await publish(releases);
  log(
    `npm publish completed (published: ${npmResult.published.length}, skipped: ${npmResult.skipped.length}).`,
  );

  publishReleases(releases, { ghToken });
  log('GitHub Releases created (or already present).');
}

/**
 * Retry path when there is no new bump: tags already at HEAD may still be
 * missing on npm and/or GitHub Releases. Does not rewrite CHANGELOG.md.
 *
 * @param {{ name: string, path: string, version: string }[]} packages
 * @param {GitLookup} git
 * @param {{
 *   run?: (file: string, args: string[]) => string,
 *   publishNpmReleases?: (releases: ReleasePlan[]) => Promise<{ published: string[], skipped: string[] }>,
 *   createGitHubReleases?: (releases: ReleasePlan[], options?: { ghToken?: string }) => void,
 *   ghToken?: string,
 *   env?: NodeJS.ProcessEnv,
 *   log?: (msg: string) => void,
 *   headSha?: string,
 * }} [deps]
 * @returns {Promise<ReleasePlan[]>}
 */
export async function reconcileTaggedHead(packages, git, deps = {}) {
  const runFn = deps.run ?? run;
  const publish = deps.publishNpmReleases ?? publishNpmReleases;
  const publishReleases = deps.createGitHubReleases ?? createGitHubReleases;
  const log = deps.log ?? console.log;
  const env = deps.env ?? process.env;
  const headSha = deps.headSha ?? runFn('git', ['rev-parse', 'HEAD']);

  const atHead = releaseSpecsForTagsAtHead(packages, git, headSha, runFn);
  if (atHead.length === 0) return [];

  const ghToken = deps.ghToken ?? takeAndClearAppTokenFromEnv(env);

  const npmResult = await publish(atHead);
  log(
    `npm publish completed (published: ${npmResult.published.length}, skipped: ${npmResult.skipped.length}).`,
  );
  publishReleases(atHead, { ghToken });
  log('GitHub Releases created (or already present).');
  return atHead;
}

function defaultGitLookup() {
  return {
    getLastTag,
    getCommitMessages,
    tagExists,
  };
}

/**
 * @returns {boolean}
 */
function isExecutedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(resolve(entry)).href;
  } catch {
    return false;
  }
}

async function main() {
  if (CI) {
    syncToOriginMain();
  }

  const packages = listWorkspacePackages();
  if (packages.length === 0) {
    console.log(NOTHING_TO_RELEASE_MESSAGE);
    return;
  }

  const git = defaultGitLookup();
  /** @type {ReleasePlan[]} */
  const releases = [];

  for (const pkg of packages) {
    const planned = planPackageRelease(pkg, git);
    if (planned) releases.push(planned);
  }

  if (releases.length === 0) {
    if (CI) {
      await reconcileTaggedHead(packages, git);
    }
    console.log(NOTHING_TO_RELEASE_MESSAGE);
    return;
  }

  console.log(CI ? 'Releasing:' : 'Dry-run — would release:');
  for (const r of releases) {
    console.log(`  ${r.name}: ${r.version} → ${r.next} (${r.increment}) [${r.tag}]`);
  }

  if (!CI) {
    console.log(
      '\nRe-run with --ci to bump, commit, push to main, tag, npm publish, and create GitHub Releases.',
    );
    return;
  }

  await applyCiRelease(releases);
}

if (isExecutedDirectly()) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
