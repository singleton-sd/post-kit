#!/usr/bin/env node
/**
 * Cross-platform PowerShell launcher for pnpm scripts.
 *
 * Windows often has `powershell` (Windows PowerShell 5.1). macOS/Linux typically
 * install PowerShell 7 as `pwsh` only — calling `powershell` fails with
 * "command not found". Prefer `pwsh`, then fall back to `powershell`.
 *
 * Usage:
 *   node ./scripts/invoke-ps1.mjs ./scripts/bootstrap-worktree.ps1 [-QuickCheck]
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// pnpm may forward a literal `--` separator; ignore it.
const argv = process.argv.slice(2).filter((arg) => arg !== '--');
const scriptArg = argv[0];
const passthrough = argv.slice(1);

if (!scriptArg) {
  console.error('Usage: node scripts/invoke-ps1.mjs <script.ps1> [args...]');
  process.exit(1);
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = path.isAbsolute(scriptArg) ? scriptArg : path.resolve(repoRoot, scriptArg);

function canRun(command) {
  const probe = spawnSync(command, ['-NoProfile', '-Command', 'exit 0'], {
    encoding: 'utf8',
    stdio: 'ignore',
  });
  return probe.error == null && probe.status === 0;
}

function resolveShell() {
  const candidates = process.platform === 'win32' ? ['powershell', 'pwsh'] : ['pwsh', 'powershell'];
  for (const candidate of candidates) {
    if (canRun(candidate)) {
      return candidate;
    }
  }
  return null;
}

const shell = resolveShell();
if (!shell) {
  console.error(
    'error: PowerShell not found on PATH. Install PowerShell 7+ (`pwsh`) or use the bash equivalent when one exists (see AGENTS.md).',
  );
  process.exit(1);
}

const result = spawnSync(
  shell,
  ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...passthrough],
  { stdio: 'inherit', cwd: repoRoot },
);

if (result.error) {
  console.error(`error: failed to launch ${shell}: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
