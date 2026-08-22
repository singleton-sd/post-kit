import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import {
  blockerAction,
  evaluateSnapshot,
  expectedChecks,
  formatGateReport,
  isRateLimitError,
  parseArgs,
  parsePaginatedGhApiOutput,
} from './pr-handoff-gate.mjs';

assert.deepEqual(parsePaginatedGhApiOutput('[{"id":1},{"id":2}]'), [{ id: 1 }, { id: 2 }]);
assert.deepEqual(parsePaginatedGhApiOutput('[[{"id":1}],[{"id":2}]]'), [{ id: 1 }, { id: 2 }]);
assert.deepEqual(parsePaginatedGhApiOutput('[{"id":1}]\n[{"id":2}]'), [{ id: 1 }, { id: 2 }]);
assert.deepEqual(parsePaginatedGhApiOutput(''), []);

assert.deepEqual(expectedChecks(['apps/api/src/index.ts']), ['Lint / test / build']);
assert.deepEqual(expectedChecks(['package.json']), ['Lint / test / build']);
assert.deepEqual(expectedChecks(['packages/post-kit-email/src/index.ts']), ['Lint / test / build']);
assert.deepEqual(expectedChecks(['README.md']), ['Lint / test / build']);
assert.deepEqual(parsePaginatedGhApiOutput('[{"login":"github-actions[bot]"}]'), [
  { login: 'github-actions[bot]' },
]);
assert.deepEqual(parsePaginatedGhApiOutput('[{"login":"github-actions[bot"}]\n[{"id":2}]'), [
  { login: 'github-actions[bot' },
  { id: 2 },
]);

assert.equal(parseArgs(['--pr', '1', '--poll-seconds', '10']).pollMs, 10_000);
assert.equal(parseArgs(['--pr', '1', '--poll-seconds', '0.001']).pollMs, 1);
assert.throws(
  () => parseArgs(['--pr', '1', '--poll-seconds', '0']),
  /--poll-seconds must be between 0.001 and 2147483.647/,
);
assert.throws(
  () => parseArgs(['--pr', '1', '--poll-seconds', '0.000999']),
  /--poll-seconds must be between 0.001 and 2147483.647/,
);
assert.throws(
  () => parseArgs(['--pr', '1', '--poll-seconds', '2147483.648']),
  /--poll-seconds must be between 0.001 and 2147483.647/,
);

const now = Date.now();
const base = {
  headOid: 'abc',
  observedHeadOid: 'abc',
  mergeable: 'MERGEABLE',
  mergeStateStatus: 'CLEAN',
  labels: [],
  expected: ['CI'],
  checks: [{ name: 'CI', status: 'COMPLETED', conclusion: 'SUCCESS' }],
  unresolvedThreads: 0,
  lastActivityMs: now - 100_000,
};
assert.equal(evaluateSnapshot(base, now, 90_000).ready, true);
assert.match(
  evaluateSnapshot({ ...base, checks: [] }, now, 90_000).blockers.join(' '),
  /not registered/,
);
assert.match(
  evaluateSnapshot({ ...base, unresolvedThreads: 1 }, now, 90_000).blockers.join(' '),
  /unresolved/,
);
assert.match(
  evaluateSnapshot({ ...base, labels: ['has-feedback'] }, now, 90_000).blockers.join(' '),
  /blocking labels/,
);
assert.match(
  evaluateSnapshot({ ...base, labels: ['ci-failed', 'preview-blocked'] }, now, 0).blockers.join(
    ' ',
  ),
  /blocking labels: ci-failed$/,
);
assert.equal(evaluateSnapshot({ ...base, labels: ['preview-blocked'] }, now, 0).ready, true);
assert.equal(
  evaluateSnapshot(
    {
      ...base,
      expected: ['Lint / test / build'],
      checks: [
        { name: 'Lint / test / build', status: 'COMPLETED', conclusion: 'SUCCESS' },
        { name: 'Build and deploy web ACA preview', status: 'COMPLETED', conclusion: 'FAILURE' },
      ],
    },
    now,
    0,
  ).ready,
  true,
);
assert.match(
  evaluateSnapshot({ ...base, lastActivityMs: now - 1_000 }, now, 90_000).blockers.join(' '),
  /quiet period/,
);
assert.equal(evaluateSnapshot(base, now, 0).ready, true);
assert.equal(isRateLimitError('API rate limit already exceeded for site ID installation.'), true);
assert.equal(isRateLimitError('You have exceeded a secondary rate limit'), true);
assert.equal(isRateLimitError('gh: pull request not found'), false);
assert.equal(isRateLimitError(undefined), false);

assert.match(blockerAction('checks pending: Lint / test / build'), /Wait/);
assert.match(blockerAction('check failed: CI (FAILURE)'), /Open the failed checks/);
const pr101Result = evaluateSnapshot(
  {
    ...base,
    expected: ['Lint / test / build'],
    checks: [{ name: 'Lint / test / build', status: 'IN_PROGRESS', conclusion: '' }],
  },
  now,
  90_000,
);
const report = formatGateReport({ pr: 101, snapshot: base, result: pr101Result });
assert.match(report, /PR #101 handoff gate/);
assert.match(report, /checks pending: Lint \/ test \/ build/);
assert.match(report, /What to do/);

const mixedFailures = evaluateSnapshot(
  {
    ...base,
    expected: ['cancelled', 'broken'],
    checks: [
      { name: 'cancelled', status: 'COMPLETED', conclusion: 'CANCELLED' },
      { name: 'broken', status: 'COMPLETED', conclusion: 'FAILURE' },
    ],
  },
  now,
  90_000,
);
const mixedReport = formatGateReport({ pr: 101, snapshot: base, result: mixedFailures });
assert.match(mixedReport, /Re-run the cancelled checks/);
assert.match(mixedReport, /Open the failed checks/);

assert.equal(
  existsSync(new URL('../.github/workflows/pr-handoff-gate.yml', import.meta.url)),
  false,
);

console.log('pr-handoff-gate tests passed');
