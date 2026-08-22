#!/usr/bin/env node
/**
 * Route `pnpm bootstrap:worktree` to bash on Unix and PowerShell on Windows.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptsDir = path.join(repoRoot, 'scripts');
const argv = process.argv.slice(2).filter((arg) => arg !== '--');
const quick = argv.includes('--quick-check') || argv.includes('-QuickCheck');

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', cwd: repoRoot });
  if (result.error) {
    console.error(`error: failed to launch ${command}: ${result.error.message}`);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

if (process.platform === 'win32') {
  const args = [
    path.join(scriptsDir, 'invoke-ps1.mjs'),
    path.join(scriptsDir, 'bootstrap-worktree.ps1'),
  ];
  if (quick) args.push('-QuickCheck');
  run(process.execPath, args);
}

const args = [path.join(scriptsDir, 'bootstrap-worktree.sh')];
if (quick) args.push('--quick-check');
run('bash', args);
