import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const invokePs1 = path.join(scriptsDir, 'invoke-ps1.mjs');
const invokeWorktreeAdd = path.join(scriptsDir, 'invoke-worktree-add.mjs');

test('invoke-ps1 prints usage when script path is missing', () => {
  const result = spawnSync(process.execPath, [invokePs1], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Usage: node scripts\/invoke-ps1\.mjs/);
});

test('invoke-worktree-add rejects missing Issue/Slug', () => {
  const result = spawnSync(process.execPath, [invokeWorktreeAdd], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Usage: pnpm worktree:add/);
});

test('invoke-worktree-add dry-run accepts Windows-style flags on Unix', function () {
  if (process.platform === 'win32') {
    this.skip();
  }
  const result = spawnSync(
    process.execPath,
    [
      invokeWorktreeAdd,
      '--',
      '-Issue',
      '184',
      '-Type',
      'feat',
      '-Slug',
      'macos-script-executability',
      '-DryRun',
      '-SkipBootstrap',
    ],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /feat\/184-macos-script-executability/);
});

test('invoke-worktree-add dry-run accepts GitHub-native issue/type flags', function () {
  if (process.platform === 'win32') {
    this.skip();
  }
  const result = spawnSync(
    process.execPath,
    [
      invokeWorktreeAdd,
      '--',
      '-Issue',
      '174',
      '-Type',
      'docs',
      '-Slug',
      'github-native-orchestration',
      '-DryRun',
      '-SkipBootstrap',
    ],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /docs\/174-github-native-orchestration/);
});
