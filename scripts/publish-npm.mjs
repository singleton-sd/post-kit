/**
 * npm Trusted Publishing helpers for path-aware monorepo releases.
 *
 * Publishes with `pnpm publish` so `workspace:*` deps rewrite to concrete
 * versions. Auth is OIDC in GitHub Actions — never pass NPM_TOKEN here.
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
 * True when `name@version` is already on the public registry.
 * Used so a partial release can recover without republishing immutable versions.
 *
 * @param {string} name
 * @param {string} version
 * @param {{ run?: (file: string, args: string[], options?: object) => string }} [options]
 * @returns {boolean}
 */
export function isVersionOnNpm(name, version, options = {}) {
  const run =
    options.run ??
    ((file, args, opts = {}) =>
      execFileSync(file, args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        ...opts,
      }).trim());

  try {
    const out = run(
      'npm',
      ['view', `${name}@${version}`, 'version', '--registry', 'https://registry.npmjs.org'],
      {},
    );
    return String(out).trim() === version;
  } catch {
    return false;
  }
}

/**
 * @param {{ name: string, path: string, next?: string }} release
 * @param {{ run?: (file: string, args: string[], options?: object) => string, log?: (msg: string) => void }} [options]
 * @returns {'published' | 'skipped'}
 */
export function buildAndPublishPackage(release, options = {}) {
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

  if (isVersionOnNpm(release.name, version, { run })) {
    log(`Skipping ${release.name}@${version} — already on npmjs.`);
    return 'skipped';
  }

  log(`Building ${packagePath}…`);
  run('pnpm', ['run', 'build'], { cwd: packagePath });

  log(`Publishing ${release.name}@${version} to npmjs (OIDC / Trusted Publishing)…`);
  // --no-git-checks: release commit may not be pushed yet; we publish before push
  // so a failed publish does not leave tags on origin/main.
  run('pnpm', ['publish', '--access', 'public', '--no-git-checks'], {
    cwd: packagePath,
  });
  return 'published';
}

/**
 * @param {{ name: string, path: string, next?: string }[]} releases
 * @param {{ run?: (file: string, args: string[], options?: object) => string, log?: (msg: string) => void }} [options]
 * @returns {{ published: string[], skipped: string[] }}
 */
export function publishNpmReleases(releases, options = {}) {
  const ordered = sortReleasesForPublish(releases);
  /** @type {string[]} */
  const published = [];
  /** @type {string[]} */
  const skipped = [];
  for (const release of ordered) {
    const result = buildAndPublishPackage(release, options);
    const label = `${release.name}@${release.next ?? '?'}`;
    if (result === 'skipped') skipped.push(label);
    else published.push(label);
  }
  return { published, skipped };
}
