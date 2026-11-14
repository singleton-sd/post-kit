#!/usr/bin/env node
/**
 * Path-aware independent tag-only releases for the pnpm monorepo.
 *
 * Computes the next version for each `@singleton-sd/post-kit-*` workspace
 * package from its latest reachable `@scope/name@version` tag plus
 * conventional commits since that tag. In CI it writes every workspace
 * package version (last tag, or the planned bump) in the workspace only
 * (`npm version --no-git-tag-version`), pushes **tags only**, publishes to
 * npmjs via Trusted Publishing (OIDC), and creates GitHub Releases with
 * generated notes.
 *
 * Never commits or pushes to the default branch. package.json on main is
 * not the published version; tags / npm / GitHub Releases are canonical.
 *
 * Usage:
 *   node scripts/release-changed.mjs           # dry-run
 *   node scripts/release-changed.mjs --ci      # bump in workspace, tag, npm publish, GitHub Releases
 */
import { execFileSync, execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import semver from 'semver';
import { createGitHubReleases } from './github-releases.mjs';
import { fetchNpmVersionMetadata, publishNpmReleases } from './publish-npm.mjs';

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
 * True when npm's recorded `gitHead` is the same commit as HEAD.
 * @param {string | null} gitHead
 * @param {string} headSha
 */
export function headsMatch(gitHead, headSha) {
  if (!gitHead || !headSha) return false;
  const a = gitHead.toLowerCase();
  const b = headSha.toLowerCase();
  const n = Math.min(a.length, b.length);
  return n >= 7 && a.slice(0, n) === b.slice(0, n);
}

/**
 * Set every public workspace package's version to its latest tag, or to the
 * planned version when this run is releasing that package. `pnpm publish`
 * rewrites `workspace:*` from the live package.json, and main's committed
 * versions lag the tags.
 *
 * @param {{ name: string, path: string, version: string }[]} packages
 * @param {ReleasePlan[]} releases
 * @param {GitLookup} git
 * @param {(release: { path: string, next: string, name?: string }) => void} bump
 * @param {(msg: string) => void} [log]
 */
export function applyWorkspaceVersions(packages, releases, git, bump, log = console.log) {
  const planned = new Map(releases.map((r) => [r.name, r.next]));
  for (const pkg of packages) {
    const lastTag = git.getLastTag(pkg.name);
    const tagged = versionFromTag(pkg.name, lastTag);
    const target = planned.has(pkg.name) ? planned.get(pkg.name) : tagged;
    if (!target || !semver.valid(target)) continue;
    if (pkg.version === target) continue;
    bump({ name: pkg.name, path: pkg.path, next: target });
    log(`Set ${pkg.name} workspace version ${pkg.version} → ${target}.`);
  }
}

/** @deprecated alias — use {@link applyWorkspaceVersions} */
export const syncWorkspaceVersionsToTags = applyWorkspaceVersions;

/**
 * If the planned version is already on npm from a *different* (or unknown)
 * commit, skip to the next increment so we do not tag HEAD as that version
 * without publishing HEAD's changes. Same-commit retries keep the version
 * and only need the tag.
 *
 * @param {ReleasePlan} release
 * @param {{
 *   fetchNpmMeta: (name: string, version: string) => Promise<{ published: boolean, gitHead: string | null }>,
 *   tagExists: (tag: string) => boolean,
 *   headSha: string,
 *   log?: (msg: string) => void,
 * }} opts
 * @returns {Promise<ReleasePlan & { npmAlreadyPublished: boolean }>}
 */
export async function bindReleaseVersion(release, opts) {
  const log = opts.log ?? console.log;
  let next = release.next;
  let tag = release.tag;
  let occupied = new Set();

  for (let i = 0; i < 50; i += 1) {
    if (opts.tagExists(tag) || occupied.has(tag)) {
      const bumped = nextVersion(next, release.increment);
      next = bumped;
      tag = `${release.name}@${next}`;
      continue;
    }

    const meta = await opts.fetchNpmMeta(release.name, next);
    if (!meta.published) {
      return { ...release, next, tag, npmAlreadyPublished: false };
    }
    if (headsMatch(meta.gitHead, opts.headSha)) {
      log(`${tag} already on npm from this commit; tagging without republishing.`);
      return { ...release, next, tag, npmAlreadyPublished: true };
    }

    log(`${tag} already on npm from a different commit — skipping to next ${release.increment}.`);
    occupied.add(tag);
    const bumped = nextVersion(next, release.increment);
    next = bumped;
    tag = `${release.name}@${next}`;
  }

  throw new Error(`Could not find a free npm version for ${release.name} after ${next}`);
}

/**
 * Last-tag GitHub Releases that point at HEAD (retry after a tag push that
 * never created the Release). Does not rewrite CHANGELOG.md.
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
      tagged = runFn('git', ['rev-parse', lastTag]);
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
 *   bumpPackageVersion?: (release: { name?: string, path: string, next: string }) => void,
 *   publishNpmReleases?: (releases: ReleasePlan[]) => Promise<{ published: string[], skipped: string[] }>,
 *   createAndPushTags?: (tags: string[]) => void,
 *   createGitHubReleases?: (releases: ReleasePlan[]) => void,
 *   log?: (msg: string) => void,
 *   workspacePackages?: { name: string, path: string, version: string }[],
 *   git?: GitLookup,
 *   fetchNpmMeta?: (name: string, version: string) => Promise<{ published: boolean, gitHead: string | null }>,
 *   tagExists?: (tag: string) => boolean,
 *   headSha?: string,
 * }} [deps]
 */
export async function applyCiRelease(releases, deps = {}) {
  const bump = deps.bumpPackageVersion ?? bumpPackageVersion;
  const publish = deps.publishNpmReleases ?? publishNpmReleases;
  const pushTags = deps.createAndPushTags ?? createAndPushTags;
  const publishReleases = deps.createGitHubReleases ?? createGitHubReleases;
  const log = deps.log ?? console.log;
  const tagExistsFn = deps.tagExists ?? tagExists;
  const fetchNpmMeta = deps.fetchNpmMeta ?? fetchNpmVersionMetadata;
  const headSha = deps.headSha ?? run('git', ['rev-parse', 'HEAD']);

  /** @type {(ReleasePlan & { npmAlreadyPublished: boolean })[]} */
  const bound = [];
  for (const release of releases) {
    bound.push(
      await bindReleaseVersion(release, {
        fetchNpmMeta,
        tagExists: tagExistsFn,
        headSha,
        log,
      }),
    );
  }

  if (deps.workspacePackages && deps.git) {
    applyWorkspaceVersions(deps.workspacePackages, bound, deps.git, bump, log);
  } else {
    for (const release of bound) {
      bump(release);
    }
  }

  // Tag first so a later retry cannot bind an already-published version to a
  // newer HEAD. Reconcile republishes any tag-at-HEAD still missing on npm.
  pushTags(bound.map((r) => r.tag));
  log(TAGS_PUSHED_MESSAGE);

  const toPublish = bound.filter((release) => !release.npmAlreadyPublished);
  const npmResult = await publish(toPublish);
  log(
    `npm publish completed (published: ${npmResult.published.length}, skipped: ${npmResult.skipped.length}).`,
  );

  publishReleases(bound);
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
 *   bumpPackageVersion?: (release: { name?: string, path: string, next: string }) => void,
 *   publishNpmReleases?: (releases: ReleasePlan[]) => Promise<{ published: string[], skipped: string[] }>,
 *   createGitHubReleases?: (releases: ReleasePlan[]) => void,
 *   log?: (msg: string) => void,
 *   headSha?: string,
 * }} [deps]
 * @returns {Promise<ReleasePlan[]>}
 */
export async function reconcileTaggedHead(packages, git, deps = {}) {
  const runFn = deps.run ?? run;
  const bump = deps.bumpPackageVersion ?? bumpPackageVersion;
  const publish = deps.publishNpmReleases ?? publishNpmReleases;
  const publishReleases = deps.createGitHubReleases ?? createGitHubReleases;
  const log = deps.log ?? console.log;
  const headSha = deps.headSha ?? runFn('git', ['rev-parse', 'HEAD']);

  const atHead = releaseSpecsForTagsAtHead(packages, git, headSha, runFn);
  if (atHead.length === 0) return [];

  applyWorkspaceVersions(packages, atHead, git, bump, log);
  const npmResult = await publish(atHead);
  log(
    `npm publish completed (published: ${npmResult.published.length}, skipped: ${npmResult.skipped.length}).`,
  );
  publishReleases(atHead);
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
      '\nRe-run with --ci to bump in the workspace, push tags, npm publish, and create GitHub Releases.',
    );
    return;
  }

  await applyCiRelease(releases, { workspacePackages: packages, git });
}

if (isExecutedDirectly()) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
