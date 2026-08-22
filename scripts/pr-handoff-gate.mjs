#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const blockingConclusions = new Set([
  'ACTION_REQUIRED',
  'CANCELLED',
  'FAILURE',
  'STALE',
  'STARTUP_FAILURE',
  'TIMED_OUT',
]);
const terminalConclusions = new Set(['NEUTRAL', 'SKIPPED', 'SUCCESS']);

const REQUIRED_CI = 'Lint / test / build';

export function expectedChecks() {
  return [REQUIRED_CI];
}

/** Keep the newest rollup entry per check name (GitHub may list superseded runs). */
export function latestChecksByName(checks) {
  const byName = new Map();
  for (const check of checks) {
    const prev = byName.get(check.name);
    if (!prev) {
      byName.set(check.name, check);
      continue;
    }
    const prevAt = Date.parse(prev.completedAt || 0) || 0;
    const nextAt = Date.parse(check.completedAt || 0) || 0;
    // Prefer later completion; if timestamps tie/missing, prefer the later list item.
    if (nextAt >= prevAt) byName.set(check.name, check);
  }
  return [...byName.values()];
}

export function evaluateSnapshot(snapshot, nowMs, quietMs) {
  const checks = latestChecksByName(snapshot.checks);
  const byName = new Map(checks.map((check) => [check.name, check]));
  const missing = snapshot.expected.filter((name) => !byName.has(name));
  const pending = snapshot.expected.filter((name) => {
    const check = byName.get(name);
    return check && check.status !== 'COMPLETED';
  });
  const failed = checks.filter(
    (check) => snapshot.expected.includes(check.name) && blockingConclusions.has(check.conclusion),
  );
  const incomplete = checks.filter(
    (check) =>
      snapshot.expected.includes(check.name) &&
      (check.status !== 'COMPLETED' || !terminalConclusions.has(check.conclusion)),
  );
  const blockers = [];
  if (snapshot.headOid !== snapshot.observedHeadOid) blockers.push('PR head changed');
  if (snapshot.mergeable !== 'MERGEABLE' || snapshot.mergeStateStatus === 'DIRTY') {
    blockers.push(`mergeability is ${snapshot.mergeable}/${snapshot.mergeStateStatus}`);
  }
  const blockingLabels = snapshot.labels.filter((label) =>
    ['ci-failed', 'has-feedback', 'needs-rebase'].includes(label),
  );
  // preview-blocked is reserved and must not fail handoff.
  if (blockingLabels.length) {
    blockers.push(`blocking labels: ${blockingLabels.join(', ')}`);
  }
  if (snapshot.unresolvedThreads > 0)
    blockers.push(`${snapshot.unresolvedThreads} unresolved review thread(s)`);
  if (missing.length) blockers.push(`checks not registered: ${missing.join(', ')}`);
  if (pending.length) blockers.push(`checks pending: ${pending.join(', ')}`);
  for (const check of failed) {
    blockers.push(`check failed: ${check.name} (${check.conclusion})`);
  }
  if (incomplete.length && !pending.length && !failed.length) {
    blockers.push(`checks not successful: ${incomplete.map((check) => check.name).join(', ')}`);
  }
  const quietFor = nowMs - snapshot.lastActivityMs;
  if (quietFor < quietMs) blockers.push(`review quiet period: ${quietFor}ms/${quietMs}ms`);
  return { ready: blockers.length === 0, blockers };
}

export function blockerAction(blocker) {
  if (blocker === 'PR head changed') return 'Wait for the gate run for the latest commit.';
  if (blocker.startsWith('mergeability is')) return 'Merge origin/main and resolve the conflicts.';
  if (blocker.startsWith('blocking labels:'))
    return 'Open the labelled PR problem, fix it, and remove the label.';
  if (blocker.includes('unresolved review thread'))
    return 'Address or resolve every open review thread.';
  if (blocker.startsWith('checks not registered:'))
    return 'Wait for the named workflows to start; re-run them if they never appear.';
  if (blocker.startsWith('checks pending:')) return 'Wait for the named checks to finish.';
  if (blocker.startsWith('check failed:'))
    return blocker.includes('(CANCELLED)')
      ? 'Re-run the cancelled checks; no code change is needed unless they cancel again.'
      : 'Open the failed checks, fix their errors, and push a new commit.';
  if (blocker.startsWith('checks not successful:'))
    return 'Re-run the named cancelled or incomplete checks.';
  if (blocker.startsWith('review quiet period:'))
    return 'Wait for the reviewer quiet period; no action is required.';
  return 'Inspect the gate log for details.';
}

export function formatGateReport({ pr, snapshot, result }) {
  const lines = [
    `## PR #${pr} handoff gate`,
    '',
    result.ready
      ? '✅ **Ready to hand off.** All required checks passed and feedback is stable.'
      : '⏳ **Not ready to hand off.** Work through the items below.',
    '',
  ];
  if (!result.ready) {
    lines.push('| Blocker | What to do |', '| --- | --- |');
    for (const blocker of result.blockers) {
      lines.push(`| ${blocker.replaceAll('|', '\\|')} | ${blockerAction(blocker)} |`);
    }
    lines.push('');
  }
  lines.push(
    `**Commit checked:** \`${snapshot.headOid}\``,
    '',
    '_This summary shows the final state observed by this workflow run._',
  );
  return `${lines.join('\n')}\n`;
}

function gh(args, options = {}) {
  const result = spawnSync('gh', args, { encoding: 'utf8', ...options });
  if (result.error) throw new Error(result.error.message);
  if (result.status !== 0) {
    throw new Error((result.stderr ?? '').trim() || `gh ${args.join(' ')} failed`);
  }
  return result.stdout;
}

const READY_LABEL = 'ready-for-human';

/**
 * The `ready-for-human` label is the single signal that a PR is mergeable,
 * required CI is green, and there is no open actionable feedback.
 */
function syncReadyForHumanLabel(prNumber, ready) {
  try {
    const exists = gh([
      'label',
      'list',
      '--search',
      READY_LABEL,
      '--json',
      'name',
      '--jq',
      '.[].name',
    ])
      .trim()
      .split('\n');
    if (!exists.includes(READY_LABEL)) {
      gh([
        'label',
        'create',
        READY_LABEL,
        '--color',
        '0e8a16',
        '--description',
        'Mergeable, required CI green, no open feedback — ready for human merge',
      ]);
    }
    gh(['pr', 'edit', String(prNumber), ready ? '--add-label' : '--remove-label', READY_LABEL]);
  } catch (error) {
    // Best-effort: never fail the gate over a label sync problem.
    process.stderr.write(`warning: could not sync ${READY_LABEL} label: ${error.message}\n`);
  }
}

export function isRateLimitError(message) {
  return /rate limit/i.test(message ?? '');
}

// Many PRs can trigger this gate at once (CI workflow_run plus
// review/comment events), and they share the GitHub App installation's API
// rate limit. A transient limit hit must not be treated as "PR not ready" —
// that would report a false failure. Retry until the limit clears or the
// gate's own deadline passes.
async function retryOnRateLimit(fn, { pollMs, deadline }) {
  for (;;) {
    try {
      return fn();
    } catch (error) {
      if (!isRateLimitError(error.message) || Date.now() >= deadline) throw error;
      process.stderr.write(
        `GitHub API rate limit hit, retrying in ${pollMs}ms: ${error.message}\n`,
      );
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }
}

/**
 * Parse `gh api --paginate` output.
 *
 * Newer gh supports `--slurp` (one JSON array of page arrays). Older gh
 * (common on macOS Homebrew installs) concatenates page JSON documents —
 * usually one array per page — without `--slurp`.
 */
export function parsePaginatedGhApiOutput(raw) {
  const text = (raw ?? '').trim();
  if (!text) return [];

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      // --slurp: [page1Array, page2Array, ...] or a single page array of items
      if (parsed.length > 0 && Array.isArray(parsed[0])) {
        return parsed.flat();
      }
      return parsed;
    }
  } catch {
    // Fall through to multi-document parsing for older gh --paginate output.
  }

  const items = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '[') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === ']') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        const chunk = JSON.parse(text.slice(start, i + 1));
        if (Array.isArray(chunk)) items.push(...chunk);
        start = -1;
      }
    }
  }
  return items;
}

function paginated(endpoint) {
  // Prefer --slurp when available; fall back for older gh (no --slurp flag).
  try {
    return parsePaginatedGhApiOutput(
      gh(['api', '--paginate', '--slurp', `${endpoint}?per_page=100`]),
    );
  } catch (error) {
    if (!/unknown flag: --slurp/i.test(error.message ?? '')) throw error;
    return parsePaginatedGhApiOutput(gh(['api', '--paginate', `${endpoint}?per_page=100`]));
  }
}

function externalActivityMs(pr, author) {
  const issueComments = paginated(`repos/${pr.repository}/issues/${pr.number}/comments`);
  const reviewComments = paginated(`repos/${pr.repository}/pulls/${pr.number}/comments`);
  const reviews = paginated(`repos/${pr.repository}/pulls/${pr.number}/reviews`);
  const interesting = [...issueComments, ...reviewComments, ...reviews].filter((item) => {
    const login = item.user?.login ?? '';
    if (!login || login === author || login === 'github-actions[bot]') return false;
    const lower = login.toLowerCase();
    const body = (item.body ?? '').toLowerCase();
    if (body.includes("couldn't run - usage limit reached")) return false;
    return (
      /bugbot|cursor|codex|chatgpt/.test(lower) ||
      ['OWNER', 'MEMBER', 'COLLABORATOR', 'CONTRIBUTOR'].includes(item.author_association)
    );
  });
  const times = interesting
    .map((item) => Date.parse(item.updated_at ?? item.submitted_at ?? item.created_at))
    .filter(Number.isFinite);
  return times.length === 0 ? 0 : Math.max(...times);
}

function unresolvedThreads(pr) {
  const query = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){nodes{isResolved isOutdated}}}}}`;
  const output = gh([
    'api',
    'graphql',
    '-f',
    `query=${query}`,
    '-F',
    `owner=${pr.owner}`,
    '-F',
    `name=${pr.name}`,
    '-F',
    `number=${pr.number}`,
  ]);
  const nodes = JSON.parse(output).data.repository.pullRequest.reviewThreads.nodes;
  return nodes.filter((thread) => !thread.isResolved && !thread.isOutdated).length;
}

function loadSnapshot(number, observedHeadOid) {
  const repository = gh([
    'repo',
    'view',
    '--json',
    'nameWithOwner',
    '--jq',
    '.nameWithOwner',
  ]).trim();
  const [owner, name] = repository.split('/');
  const view = JSON.parse(
    gh([
      'pr',
      'view',
      String(number),
      '--json',
      'author,headRefOid,labels,mergeable,mergeStateStatus,statusCheckRollup',
    ]),
  );
  const paths = gh(['pr', 'diff', String(number), '--name-only'])
    .trim()
    .split('\n')
    .filter(Boolean);
  const checks = (view.statusCheckRollup ?? [])
    .map((check) => ({
      name: check.name ?? check.context,
      status: check.status ?? 'COMPLETED',
      conclusion: (check.conclusion ?? check.state ?? '').toUpperCase(),
      completedAt: check.completedAt,
    }))
    // The server workflow publishes this status before running the gate. It
    // must not wait on itself.
    .filter((check) => !['gate', 'pr-handoff-gate', 'recover'].includes(check.name));
  const checkActivity = Math.max(
    0,
    ...checks.map((check) => Date.parse(check.completedAt || 0)).filter(Number.isFinite),
  );
  const pr = { repository, owner, name, number };
  return {
    headOid: view.headRefOid,
    observedHeadOid,
    mergeable: view.mergeable,
    mergeStateStatus: view.mergeStateStatus,
    labels: (view.labels ?? []).map((label) => label.name),
    checks,
    expected: expectedChecks(paths),
    unresolvedThreads: unresolvedThreads(pr),
    lastActivityMs: Math.max(checkActivity, externalActivityMs(pr, view.author.login)),
  };
}

export async function runGate({
  pr,
  quietMs,
  timeoutMs,
  pollMs,
  once = false,
  reportFile,
  label = true,
}) {
  const deadline = Date.now() + timeoutMs;
  const initial = JSON.parse(
    await retryOnRateLimit(() => gh(['pr', 'view', String(pr), '--json', 'headRefOid']), {
      pollMs,
      deadline,
    }),
  );
  const observedHeadOid = initial.headRefOid;
  while (Date.now() <= deadline) {
    const snapshot = await retryOnRateLimit(() => loadSnapshot(pr, observedHeadOid), {
      pollMs,
      deadline,
    });
    const result = evaluateSnapshot(snapshot, Date.now(), quietMs);
    if (reportFile) {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(reportFile, formatGateReport({ pr, snapshot, result }));
    }
    if (result.ready) {
      process.stdout.write(`PR #${pr} handoff gate passed at ${snapshot.headOid}\n`);
      if (label) syncReadyForHumanLabel(pr, true);
      return;
    }
    process.stderr.write(`PR #${pr} not ready: ${result.blockers.join('; ')}\n`);
    if (once) {
      if (label) syncReadyForHumanLabel(pr, false);
      throw new Error('PR handoff gate did not pass');
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  if (label) syncReadyForHumanLabel(pr, false);
  throw new Error('PR handoff gate timed out');
}

function parseArgs(argv) {
  const value = (name, fallback) => {
    const index = argv.indexOf(name);
    return index === -1 ? fallback : argv[index + 1];
  };
  const finite = (raw, name) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new Error(`${name} must be a finite number`);
    return n;
  };
  const pr = Number(value('--pr', process.env.PR_NUMBER));
  if (!Number.isInteger(pr) || pr <= 0) throw new Error('--pr is required');
  return {
    pr,
    quietMs:
      finite(
        value('--quiet-seconds', process.env.PR_GATE_QUIET_SECONDS ?? '0'),
        '--quiet-seconds',
      ) * 1000,
    timeoutMs:
      finite(
        value('--timeout-seconds', process.env.PR_GATE_TIMEOUT_SECONDS ?? '1800'),
        '--timeout-seconds',
      ) * 1000,
    pollMs:
      finite(value('--poll-seconds', process.env.PR_GATE_POLL_SECONDS ?? '10'), '--poll-seconds') *
      1000,
    once: argv.includes('--once'),
    reportFile: value('--report-file', process.env.PR_GATE_REPORT_FILE),
    label: !argv.includes('--no-label') && process.env.PR_GATE_NO_LABEL !== '1',
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runGate(parseArgs(process.argv.slice(2))).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
