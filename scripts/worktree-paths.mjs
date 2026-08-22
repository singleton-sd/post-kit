import path from 'node:path';
import { fileURLToPath } from 'node:url';

// GitHub-native issue number (e.g. 174).
const ISSUE_ID = /^[1-9][0-9]*$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TYPE = /^[a-z]+$/;
const DEFAULT_TYPE = 'feature';

export function assertIssueId(issueId) {
  if (typeof issueId !== 'string' || !ISSUE_ID.test(issueId)) {
    throw new Error(`Issue id must be a GitHub issue number (e.g. 174), got: ${issueId}`);
  }
}

export function assertSlug(slug) {
  if (typeof slug !== 'string' || slug.length === 0) {
    throw new Error('Slug is required (kebab-case issue title).');
  }
  if (!SLUG.test(slug)) {
    throw new Error(`Slug must be kebab-case (a-z0-9 and hyphens), got: ${slug}`);
  }
}

export function assertType(type) {
  if (typeof type !== 'string' || !TYPE.test(type)) {
    throw new Error(
      `Branch type must be lowercase letters (e.g. feat, fix, docs, chore, hotfix), got: ${type}`,
    );
  }
}

export function folderName(issueId, slug) {
  assertIssueId(issueId);
  assertSlug(slug);
  return `${issueId}-${slug}`;
}

export function branchName({ issueId, slug, type, hotfix = false } = {}) {
  const folder = folderName(issueId, slug);
  // `hotfix: true` is an alias predating the `type` parameter; an explicit
  // `type` always wins.
  const resolvedType = type ?? (hotfix ? 'hotfix' : DEFAULT_TYPE);
  assertType(resolvedType);
  return `${resolvedType}/${folder}`;
}

export function mainRepoFromGitCommonDir(gitCommonDir) {
  if (typeof gitCommonDir !== 'string' || gitCommonDir.length === 0) {
    throw new Error('gitCommonDir is required.');
  }
  const resolved = path.resolve(gitCommonDir);
  if (path.basename(resolved) === '.git') {
    return path.dirname(resolved);
  }
  throw new Error(`git-common-dir should end with .git, got: ${gitCommonDir}`);
}

export function workspaceRootFromRepo(repoRoot) {
  if (typeof repoRoot !== 'string' || repoRoot.length === 0) {
    throw new Error('repoRoot is required.');
  }
  return path.dirname(path.resolve(repoRoot));
}

export function worktreePath({ repoRoot, issueId, slug } = {}) {
  return path.join(workspaceRootFromRepo(repoRoot), 'worktrees', folderName(issueId, slug));
}

function parseArgs(argv) {
  const out = { hotfix: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--hotfix') {
      out.hotfix = true;
      continue;
    }
    if (arg === '--repo' || arg === '--issueId' || arg === '--slug' || arg === '--type') {
      out[arg.slice(2)] = argv[i + 1];
      i += 1;
    }
  }
  return out;
}

function main(argv) {
  const args = parseArgs(argv);
  if (!args.repo || !args.issueId || !args.slug) {
    throw new Error(
      'Usage: node scripts/worktree-paths.mjs --repo <path> --issueId <id> --slug <kebab> [--type <type>] [--hotfix]',
    );
  }
  const payload = {
    branch: branchName({
      issueId: args.issueId,
      slug: args.slug,
      type: args.type,
      hotfix: args.hotfix,
    }),
    folder: folderName(args.issueId, args.slug),
    workspaceRoot: workspaceRootFromRepo(args.repo),
    worktreePath: worktreePath({
      repoRoot: args.repo,
      issueId: args.issueId,
      slug: args.slug,
    }),
  };
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

const invokedDirectly =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
