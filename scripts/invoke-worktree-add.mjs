#!/usr/bin/env node
/**
 * Route `pnpm worktree:add` to the PowerShell or bash helper.
 *
 * GitHub-native flags (see the "GitHub-native engineering workflow" section of AGENTS.md), Windows-style and
 * bash-style:
 *   -Issue <n> -Type <type> -Slug <kebab> [-SkipBootstrap] [-DryRun]
 *   --issue <n> --type <type> --slug <kebab> [--skip-bootstrap] [--dry-run]
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptsDir = path.join(repoRoot, 'scripts');

function parseArgs(argv) {
  const out = {
    issueId: '',
    type: '',
    slug: '',
    hotfix: false,
    skipBootstrap: false,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    // pnpm forwards a literal `--` when callers use `pnpm worktree:add -- -Issue …`
    if (arg === '--') {
      continue;
    }
    const next = argv[i + 1];
    switch (arg) {
      case '-Issue':
      case '--issue':
      case '-TaskId':
      case '--task-id':
        out.issueId = next ?? '';
        i += 1;
        break;
      case '-Type':
      case '--type':
        out.type = next ?? '';
        i += 1;
        break;
      case '-Slug':
      case '--slug':
        out.slug = next ?? '';
        i += 1;
        break;
      case '-Hotfix':
      case '--hotfix':
        out.hotfix = true;
        break;
      case '-SkipBootstrap':
      case '--skip-bootstrap':
        out.skipBootstrap = true;
        break;
      case '-DryRun':
      case '--dry-run':
        out.dryRun = true;
        break;
      default:
        console.error(`error: unknown worktree:add argument: ${arg}`);
        process.exit(1);
    }
  }

  return out;
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', cwd: repoRoot });
  if (result.error) {
    console.error(`error: failed to launch ${command}: ${result.error.message}`);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

const parsed = parseArgs(process.argv.slice(2));
if (!parsed.issueId || !parsed.slug) {
  console.error(
    'Usage: pnpm worktree:add -- -Issue <n> -Type <type> -Slug <kebab> [-SkipBootstrap] [-DryRun]',
  );
  process.exit(1);
}

if (process.platform === 'win32') {
  const psArgs = [
    path.join(scriptsDir, 'invoke-ps1.mjs'),
    path.join(scriptsDir, 'add-worktree.ps1'),
    '-Issue',
    parsed.issueId,
    '-Slug',
    parsed.slug,
  ];
  if (parsed.type) psArgs.push('-Type', parsed.type);
  if (parsed.hotfix) psArgs.push('-Hotfix');
  if (parsed.skipBootstrap) psArgs.push('-SkipBootstrap');
  if (parsed.dryRun) psArgs.push('-DryRun');
  run(process.execPath, psArgs);
}

const bashArgs = [
  path.join(scriptsDir, 'add-worktree.sh'),
  '--issue',
  parsed.issueId,
  '--slug',
  parsed.slug,
];
if (parsed.type) bashArgs.push('--type', parsed.type);
if (parsed.hotfix) bashArgs.push('--hotfix');
if (parsed.skipBootstrap) bashArgs.push('--skip-bootstrap');
if (parsed.dryRun) bashArgs.push('--dry-run');
run('bash', bashArgs);
