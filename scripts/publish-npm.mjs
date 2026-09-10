/**
 * npm Trusted Publishing helpers for path-aware monorepo releases.
 *
 * Publishes with `pnpm publish` so `workspace:*` deps rewrite to concrete
 * versions. Auth is OIDC in GitHub Actions — never pass NPM_TOKEN here.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
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
 * @param {string} packagePath
 * @param {{ run?: (file: string, args: string[], options?: object) => string, log?: (msg: string) => void }} [options]
 */
export function buildAndPublishPackage(packagePath, options = {}) {
  const run =
    options.run ??
    ((file, args, opts = {}) =>
      execFileSync(file, args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        ...opts,
      }).trim());
  const log = options.log ?? console.log;

  const pkgJsonPath = join(packagePath, 'package.json');
  if (!existsSync(pkgJsonPath)) {
    throw new Error(`Missing package.json at ${packagePath}`);
  }

  log(`Building ${packagePath}…`);
  run('pnpm', ['run', 'build'], { cwd: packagePath });

  log(`Publishing ${packagePath} to npmjs (OIDC / Trusted Publishing)…`);
  // --no-git-checks: release commit may not be pushed yet; we publish before push
  // so a failed publish does not leave tags on origin/main.
  run('pnpm', ['publish', '--access', 'public', '--no-git-checks'], {
    cwd: packagePath,
  });
}

/**
 * @param {{ name: string, path: string }[]} releases
 * @param {{ run?: (file: string, args: string[], options?: object) => string, log?: (msg: string) => void }} [options]
 */
export function publishNpmReleases(releases, options = {}) {
  const ordered = sortReleasesForPublish(releases);
  for (const release of ordered) {
    buildAndPublishPackage(release.path, options);
  }
}
