import assert from 'node:assert/strict';
import path from 'node:path';
import {
  branchName,
  folderName,
  mainRepoFromGitCommonDir,
  workspaceRootFromRepo,
  worktreePath,
} from './worktree-paths.mjs';

const repoRoot = path.resolve('fixture-ws', 'main');
const workspaceRoot = path.resolve('fixture-ws');

// GitHub-native: <type>/<issue-number>-<kebab-title>
assert.equal(folderName('174', 'github-native-orchestration'), '174-github-native-orchestration');
assert.equal(
  branchName({ issueId: '174', slug: 'github-native-orchestration', type: 'docs' }),
  'docs/174-github-native-orchestration',
);
assert.equal(
  branchName({ issueId: '184', slug: 'support-ticket-api', type: 'feat' }),
  'feat/184-support-ticket-api',
);
assert.equal(
  branchName({ issueId: '211', slug: 'login-redirect', type: 'fix' }),
  'fix/211-login-redirect',
);
// No explicit type defaults to `feature/` for backward compatibility with existing tooling.
assert.equal(
  branchName({ issueId: '174', slug: 'github-native-orchestration' }),
  'feature/174-github-native-orchestration',
);
assert.equal(
  branchName({ issueId: '174', slug: 'github-native-orchestration', hotfix: true }),
  'hotfix/174-github-native-orchestration',
);

assert.equal(mainRepoFromGitCommonDir(path.join(repoRoot, '.git')), repoRoot);
assert.throws(() => mainRepoFromGitCommonDir(repoRoot), /\.git/);

assert.equal(workspaceRootFromRepo(repoRoot), workspaceRoot);
assert.equal(
  worktreePath({ repoRoot, issueId: '174', slug: 'github-native-orchestration' }),
  path.join(workspaceRoot, 'worktrees', '174-github-native-orchestration'),
);
assert.equal(
  worktreePath({ repoRoot, issueId: '184', slug: 'support-ticket-api' }),
  path.join(workspaceRoot, 'worktrees', '184-support-ticket-api'),
);
assert.equal(
  worktreePath({ repoRoot, issueId: '211', slug: 'login-redirect' }),
  path.join(workspaceRoot, 'worktrees', '211-login-redirect'),
);

assert.throws(() => branchName({ issueId: 'SSDOP-42', slug: 'dark-mode' }), /GitHub issue number/i);
assert.throws(
  () => branchName({ issueId: '86d3zc5af', slug: 'permission-gating' }),
  /GitHub issue number/i,
);
assert.throws(() => branchName({ issueId: '174', slug: 'Feature/Nope' }), /kebab/i);
assert.throws(() => branchName({ issueId: '174', slug: 'docs', type: 'Docs' }), /lowercase/i);
assert.throws(() => folderName('174', ''), /slug/i);

console.log('worktree-paths.test.mjs: ok');
