/**
 * Fail CI when visual capture found changed or new stories vs committed baselines.
 *
 * Reads `test-results/visual/manifest.json` from `pnpm test:visual`.
 * Set VISUAL_ACCEPTED=1 (or label `visual-accepted` in CI) to pass anyway.
 * This backs the `visual-review` check — a human review gate, not a
 * Playwright infrastructure failure.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const manifestEnv = process.env.VISUAL_MANIFEST;
const manifestPath = manifestEnv
  ? path.isAbsolute(manifestEnv)
    ? manifestEnv
    : path.join(rootDir, manifestEnv)
  : path.join(rootDir, 'test-results/visual/manifest.json');
const accepted = process.env.VISUAL_ACCEPTED === '1' || process.env.VISUAL_ACCEPTED === 'true';

assert.ok(
  existsSync(manifestPath),
  `Missing visual manifest at ${manifestPath}. Run pnpm test:visual first.`,
);

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const summary = manifest.summary ?? {
  total: manifest.stories?.length ?? 0,
  unchanged: 0,
  changed: 0,
  new: 0,
  changedStories: [],
  newStories: [],
  hasDiffs: false,
};

if (!manifest.summary && Array.isArray(manifest.stories)) {
  const changedStories = [
    ...new Set(manifest.stories.filter((m) => m.status === 'changed').map((m) => m.story)),
  ].sort();
  const newStories = [
    ...new Set(manifest.stories.filter((m) => m.status === 'new').map((m) => m.story)),
  ].sort();
  summary.changed = changedStories.length;
  summary.new = newStories.length;
  summary.changedStories = changedStories;
  summary.newStories = newStories;
  summary.unchanged = manifest.stories.filter((m) => m.status === 'unchanged').length;
  summary.hasDiffs = changedStories.length > 0 || newStories.length > 0;
}

const changedList = summary.changedStories ?? summary.changedRoutes ?? [];
const newList = summary.newStories ?? summary.newRoutes ?? [];

const lines = [
  `Visual review: ${summary.total} comparisons`,
  `- unchanged viewports: ${summary.unchanged}`,
  `- changed stories (${summary.changed}): ${changedList.join(', ') || '—'}`,
  `- new stories (${summary.new}): ${newList.join(', ') || '—'}`,
];

for (const line of lines) {
  console.log(line);
}

if (!summary.hasDiffs) {
  console.log('Visual review passed: no new or changed stories vs baselines.');
  process.exit(0);
}

if (accepted) {
  console.log(
    'Visual review passed: changes present but VISUAL_ACCEPTED is set (label visual-accepted).',
  );
  process.exit(0);
}

const reason =
  summary.changed > 0 && summary.new > 0
    ? `pixel changes (${changedList.join(', ') || '—'}) and new stories (${newList.join(', ') || '—'})`
    : summary.new > 0
      ? `new story(ies): ${newList.join(', ') || '—'}`
      : `pixel changes: ${changedList.join(', ') || '—'}`;

console.error(
  `Visual review required (${reason}). Download the editor-visual artifact, review diffs, then either update visual-baselines/ or add the visual-accepted label.`,
);
process.exit(1);
