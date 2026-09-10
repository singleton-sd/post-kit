/**
 * npm Trusted Publishing helpers for path-aware monorepo releases.
 *
 * Publishes with `pnpm publish` so `workspace:*` deps rewrite to concrete
 * versions. Auth is OIDC in GitHub Actions — never pass NPM_TOKEN here.
 *
 * Aligned with `engineering/publish-npm-library` and the live reference
 * `singleton-sd/poc-inkads-epaper-renderer` (OIDC Release workflow).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Publish order: dependents after dependencies.
 * Packages not listed sort last (stable by name).
 */
export const PUBLISH_ORDER = [
  '@singleton-sd/post-kit-types',
  '@singleton-sd/post-kit-email',
  '@singleton-sd/post-kit-compiler',
  '@singleton-sd/post-kit-client',
  '@singleton-sd/post-kit-publisher',
  '@singleton-sd/post-kit-editor',
];

/**
 * @param {{ name: string }[]} releases
 * @returns {{ name: string }[]}
 */
export function sortReleasesForPublish(releases) {
  return [...releases].sort((a, b) => {
    const ai = PUBLISH_ORDER.indexOf(a.name);
    const bi = PUBLISH_ORDER.indexOf(b.name);
    const aRank = ai === -1 ? PUBLISH_ORDER.length : ai;
    const bRank = bi === -1 ? PUBLISH_ORDER.length : bi;
    if (aRank !== bRank) return aRank - bRank;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Registry document URL for an exact package version.
 * Prefer this over `npm view`: package-root metadata can 404 briefly after
 * first publish while `/<name>/<version>` and tarballs already work.
 *
 * @param {string} name
 * @param {string} version
 * @returns {string}
 */
export function npmVersionRegistryUrl(name, version) {
  return `https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`;
}

/**
 * True when `name@version` is already on the public registry.
 * Used so a partial release can recover without republishing immutable versions.
 *
 * - HTTP 200 → published (skip)
 * - HTTP 404 → not published (publish)
 * - Any other failure (DNS, 5xx, network) → throw (do not treat as unpublished)
 *
 * @param {string} name
 * @param {string} version
 * @param {{ fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<boolean>}
 */
export async function isVersionOnNpm(name, version, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is required to probe the npm registry');
  }

  const url = npmVersionRegistryUrl(name, version);
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to reach npm registry while checking ${name}@${version}: ${detail}`, {
      cause: err,
    });
  }

  if (response.status === 200) {
    return true;
  }
  if (response.status === 404) {
    return false;
  }

  throw new Error(
    `Unexpected npm registry status ${response.status} for ${name}@${version} (${url})`,
  );
}

/**
 * @param {{ name: string, path: string, next?: string }} release
 * @param {{ run?: (file: string, args: string[], options?: object) => string, log?: (msg: string) => void, fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<'published' | 'skipped'>}
 */
export async function buildAndPublishPackage(release, options = {}) {
  const run =
    options.run ??
    ((file, args, opts = {}) =>
      execFileSync(file, args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        ...opts,
      }).trim());
  const log = options.log ?? console.log;
  const packagePath = release.path;

  const pkgJsonPath = join(packagePath, 'package.json');
  if (!existsSync(pkgJsonPath)) {
    throw new Error(`Missing package.json at ${packagePath}`);
  }

  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
  const version =
    typeof release.next === 'string'
      ? release.next
      : typeof pkgJson.version === 'string'
        ? pkgJson.version
        : null;
  if (!version) {
    throw new Error(`Cannot determine version for ${release.name}`);
  }

  if (await isVersionOnNpm(release.name, version, { fetchImpl: options.fetchImpl })) {
    log(`Skipping ${release.name}@${version} — already on npmjs.`);
    return 'skipped';
  }

  log(`Building ${packagePath}…`);
  run('pnpm', ['run', 'build'], { cwd: packagePath });

  log(`Publishing ${release.name}@${version} to npmjs (OIDC / Trusted Publishing)…`);
  // --no-git-checks: release commit may not be pushed yet; we publish before push
  // so a failed publish does not leave tags on origin/main.
  // --publish-branch main: Release job checks out main; matches InkAds requireBranch.
  run('pnpm', ['publish', '--access', 'public', '--no-git-checks', '--publish-branch', 'main'], {
    cwd: packagePath,
  });
  return 'published';
}

/**
 * @param {{ name: string, path: string, next?: string }[]} releases
 * @param {{ run?: (file: string, args: string[], options?: object) => string, log?: (msg: string) => void, fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<{ published: string[], skipped: string[] }>}
 */
export async function publishNpmReleases(releases, options = {}) {
  const ordered = sortReleasesForPublish(releases);
  /** @type {string[]} */
  const published = [];
  /** @type {string[]} */
  const skipped = [];
  for (const release of ordered) {
    const result = await buildAndPublishPackage(release, options);
    const label = `${release.name}@${release.next ?? '?'}`;
    if (result === 'skipped') skipped.push(label);
    else published.push(label);
  }
  return { published, skipped };
}
