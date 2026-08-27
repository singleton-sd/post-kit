/**
 * Create GitHub Releases for package version tags.
 *
 * Used by `scripts/release-changed.mjs` after tags are pushed. npm publish
 * remains disabled — this only creates GitHub Release entries.
 */
import { execFileSync } from 'node:child_process';

/**
 * @typedef {'major' | 'minor' | 'patch'} Increment
 * @typedef {{ name: string, version: string, next: string, increment: Increment, tag: string }} ReleaseSpec
 */

/**
 * @param {ReleaseSpec} release
 * @returns {string}
 */
export function formatReleaseTitle(release) {
  return `${release.name}@${release.next}`;
}

/**
 * @param {ReleaseSpec} release
 * @returns {string}
 */
export function formatReleaseNotes(release) {
  const bumpLine =
    release.version === release.next
      ? `## ${release.name} \`${release.next}\``
      : `## ${release.name} \`${release.version}\` → \`${release.next}\` (${release.increment})`;

  return [
    bumpLine,
    '',
    'See [CHANGELOG.md](https://github.com/singleton-sd/post-kit/blob/main/CHANGELOG.md) for monorepo release notes.',
    '',
    'npm publish is not enabled yet for this package scope.',
  ].join('\n');
}

/**
 * True when `gh release view` failed because the Release does not exist yet.
 * @param {unknown} err
 */
export function isReleaseNotFoundError(err) {
  const text = [
    err instanceof Error ? err.message : String(err),
    err && typeof err === 'object' && 'stderr' in err ? String(err.stderr) : '',
  ]
    .join('\n')
    .toLowerCase();

  return (
    text.includes('release not found') ||
    text.includes('could not find') ||
    text.includes('not found') ||
    text.includes('http 404')
  );
}

/**
 * @param {(args: string[]) => string} runGh
 * @param {string} tag
 * @returns {boolean}
 */
export function githubReleaseExists(runGh, tag) {
  try {
    runGh(['release', 'view', tag, '--json', 'tagName']);
    return true;
  } catch (err) {
    if (isReleaseNotFoundError(err)) {
      return false;
    }
    throw err;
  }
}

/**
 * @returns {(args: string[]) => string}
 */
function defaultRunGh() {
  return (args) =>
    execFileSync('gh', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
}

/**
 * Create one GitHub Release per package tag. Skips tags that already have a Release.
 *
 * @param {ReleaseSpec[]} releases
 * @param {{ runGh?: (args: string[]) => string, log?: (msg: string) => void }} [options]
 * @returns {{ created: string[], skipped: string[] }}
 */
export function createGitHubReleases(releases, options = {}) {
  const runGh = options.runGh ?? defaultRunGh();
  const log = options.log ?? console.log;

  /** @type {string[]} */
  const created = [];
  /** @type {string[]} */
  const skipped = [];

  for (const release of releases) {
    if (githubReleaseExists(runGh, release.tag)) {
      log(`GitHub Release already exists for ${release.tag}; skipping.`);
      skipped.push(release.tag);
      continue;
    }

    runGh([
      'release',
      'create',
      release.tag,
      '--verify-tag',
      '--title',
      formatReleaseTitle(release),
      '--notes',
      formatReleaseNotes(release),
    ]);
    log(`Created GitHub Release for ${release.tag}.`);
    created.push(release.tag);
  }

  return { created, skipped };
}
