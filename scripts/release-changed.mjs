#!/usr/bin/env node
/**
 * Path-aware independent tag-only releases for the pnpm monorepo.
 *
 * Computes the next version for each `@singleton-sd/post-kit-*` workspace
 * package from its latest reachable `@scope/name@version` tag plus
 * conventional commits since that tag. In CI it writes the version in the
 * workspace only (`npm version --no-git-tag-version`), publishes to npmjs
 * via Trusted Publishing (OIDC), pushes **tags only**, and creates GitHub
 * Releases with generated notes.
 *
 * Never commits or pushes to the default branch. package.json on main is
 * not the published version; tags / npm / GitHub Releases are canonical.
 *
 * Usage:
 *   node scripts/release-changed.mjs           # dry-run
 *   node scripts/release-changed.mjs --ci      # bump in workspace, npm publish, tag, GitHub Releases
 */
import { execFileSync, execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import semver from 'semver';
import { createGitHubReleases } from './github-releases.mjs';
import { publishNpmReleases } from './publish-npm.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const CI = process.argv.includes('--ci');
const PACKAGE_PREFIX = '@singleton-sd/post-kit-';
export const TAGS_PUSHED_MESSAGE = 'Release tags pushed.';
export const NOTHING_TO_RELEASE_MESSAGE = 'Nothing to release.';

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
function versionFromTag(packageName, tag) {
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
    // Empty range (e.g. tag points at HEAD) → no commits.
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
    if (subject.startsWith('chore: Release')) continue;

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
 * target tag name is free (skips orphaned remote tags). Tags are the source
 * of truth once they move ahead of package.json on main.
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
 * Write the computed next version into package.json in this workspace only.
 * `--no-git-tag-version` must never create a commit or tag.
 * @param {{ path: string, next: string }} release
 * @param {typeof run} [runFn]
 */
export function bumpPackageVersion(release, runFn = run) {
  runFn('npm', ['version', release.next, '--no-git-tag-version', '--allow-same-version'], {
    cwd: release.path,
  });
}

/**
 * Sync to origin/main before computing bumps so concurrent pushes do not
 * release from a stale tip. Does not create or push a branch.
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
 * Create and push annotated tags for the current HEAD (the merge commit).
 * Never push a branch: use `refs/tags/<name>` so branch rulesets cannot match.
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
  if (tags.length > 0) {
    const refspecs = tags.map((tag) => `refs/tags/${tag}:refs/tags/${tag}`);
    runFn('git', ['push', 'origin', ...refspecs]);
  }
}

/**
 * @param {ReleasePlan[]} releases
 * @param {{
 *   bumpPackageVersion?: (release: ReleasePlan) => void,
 *   publishNpmReleases?: (releases: ReleasePlan[]) => Promise<{ published: string[], skipped: string[] }>,
 *   createAndPushTags?: (tags: string[]) => void,
 *   createGitHubReleases?: (releases: ReleasePlan[]) => void,
 *   log?: (msg: string) => void,
 * }} [deps]
 */
export async function applyCiRelease(releases, deps = {}) {
  const bump = deps.bumpPackageVersion ?? bumpPackageVersion;
  const publish = deps.publishNpmReleases ?? publishNpmReleases;
  const pushTags = deps.createAndPushTags ?? createAndPushTags;
  const publishReleases = deps.createGitHubReleases ?? createGitHubReleases;
  const log = deps.log ?? console.log;

  for (const release of releases) {
    bump(release);
  }

  // Publish while the workspace package.json holds the computed version.
  // Already-published versions are skipped so a partial run can recover.
  const npmResult = await publish(releases);
  log(
    `npm publish completed (published: ${npmResult.published.length}, skipped: ${npmResult.skipped.length}).`,
  );

  pushTags(releases.map((r) => r.tag));
  log(TAGS_PUSHED_MESSAGE);
  publishReleases(releases);
  log('GitHub Releases created (or already present).');
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
    console.log(NOTHING_TO_RELEASE_MESSAGE);
    return;
  }

  console.log(CI ? 'Releasing:' : 'Dry-run — would release:');
  for (const r of releases) {
    console.log(`  ${r.name}: ${r.version} → ${r.next} (${r.increment}) [${r.tag}]`);
  }

  if (!CI) {
    console.log(
      '\nRe-run with --ci to bump in the workspace, npm publish, tag, and push tags only.',
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
