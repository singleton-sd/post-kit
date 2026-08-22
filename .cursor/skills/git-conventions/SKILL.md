---
name: Git Conventions
description: Apply PostKit git conventions — commit format, branch naming, and GitHub issue linking
tags: [engineering, git, conventions, commits, workflow]
audience: [engineers, tech-leads]
status: stable
---

# Git Conventions

You are a senior engineer helping enforce PostKit git conventions. Apply these
rules when writing commit messages, naming branches, or reviewing either.

## This repository

`post-kit` identifies engineering work by **GitHub issue number** (`#1`),
not a project ticket prefix. See
[`docs/github-source-of-truth.md`](../../../docs/github-source-of-truth.md)
section 6 for the authoritative branch/PR/issue policy.

## Branch naming

```text
<type>/<issue-number>-<kebab-title>
```

Examples: `feat/1-bootstrap-monorepo`, `fix/12-login-redirect`,
`docs/8-github-engineering-source-of-truth`. `<type>` is a conventional-commit
prefix matching the primary nature of the change (see the type table below).

Worktrees live beside the clone: `../worktrees/<issue-number>-<kebab-title>`.
Create them with
`pnpm worktree:add -- -Issue <issue-number> -Type <type> -Slug <kebab-title>`
(Linux/Cloud:
`./scripts/add-worktree.sh --issue <issue-number> --type <type> --slug <kebab-title>`).

## Commit message format

```text
type: #<issue-number> Description in sentence case
```

Example:

```text
feat: #1 Bootstrap monorepo foundations
```

A commit that is not tied to a single issue (a small unattributed fix, a
release commit) may omit the `#<issue-number>` — do not invent an issue
number to satisfy the format. What actually closes the issue on merge is
the `Closes #<issue-number>` line in the **PR body**
(`docs/github-source-of-truth.md` section 6), not the commit message.

### Rules

| Rule | Requirement |
|------|-------------|
| Format | `type: #<issue-number> Description` |
| Subject case | Sentence-case — first letter capitalized, rest lowercase |
| Subject max length | 50 characters |
| Subject ending | No period `.` at end |
| Issue presence | Required in commit message **or** inferrable from branch name |
| Issue format | GitHub issue number, e.g. `#1`, `#12` |
| Body separator | Blank line between subject and body (if body is present) |
| Body line length | Max 72 characters per line |
| Release commits | Skipped — format is `chore: Release package versions` (auto-generated; body lists `@scope/name@version` tags) |

### Commit body: 72-character lines

When the commit has a **body** (paragraphs or bullet list):

- **Every** body line must be **≤ 72 characters** (count spaces and punctuation).
- That includes lines that start with a bullet (`-` plus a space): the whole
  line must stay within the limit; wrap long bullets onto continuation lines
  if needed.
- Prefer breaking at natural phrase boundaries, not mid-word.

Example (subject obeys 50-character limit; each body line ≤ 72):

```text
feat: #1 Bootstrap monorepo foundations

- Root pnpm workspace, ESLint, Prettier, and Husky
- GitHub-native worktree helpers and CI
- Docs for GitHub Issues as the engineering tracker
```

Do not put `Closes #N` in the commit body — that belongs in the PR.

### Allowed types (conventional commits)

| Type | When to use |
|------|-------------|
| `feat` | New feature or user-facing behaviour |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `style` | Formatting, whitespace — no logic change |
| `refactor` | Restructure without changing behaviour |
| `perf` | Performance improvement |
| `test` | Add or update tests |
| `ci` | CI/CD pipeline changes |
| `chore` | Build scripts, tooling, dependency updates |
| `revert` | Reverting a previous commit |

## TypeScript filename conventions

Staged `.ts` files must match one of these patterns:

| Pattern | Example |
|---------|---------|
| `kebab-case.ts` | `email-provider.ts` |
| `kebab-case.spec.ts` | `email-provider.spec.ts` |
| `kebab-case.test.ts` | `email-provider.test.ts` |
| `PascalCase.ts` | `EmailProvider.ts` |
| `PascalCase.d.ts` | `EmailProvider.d.ts` |

## Versioning

Versions follow **semver** and are bumped automatically based on commit types:

| Commit type | Version bump |
|-------------|-------------|
| `fix:` | Patch (`1.2.3` → `1.2.4`) |
| `feat:` | Minor (`1.2.3` → `1.3.0`) |
| `BREAKING CHANGE:` in footer | Major (`1.2.3` → `2.0.0`) |

Never manually edit the version in a workspace `package.json`. Run `pnpm release`
(dry-run) or `pnpm release:ci` (CI on `main`) instead. Releases are **path-aware
and independent** per public workspace package; tags look like
`@singleton-sd/post-kit-email@0.1.0`.

The workspace root (`post-kit`) stays `"private": true` and is never published.

## Validation checklist

Before pushing, verify:
- [ ] Branch name matches `<type>/<issue-number>-<kebab-title>`
- [ ] Commit subject is ≤ 50 chars, sentence-case, no period
- [ ] GitHub issue number is present (in commit or inferrable from branch)
- [ ] Body lines (if any) are ≤ 72 chars with a blank separator line
- [ ] TypeScript filenames follow kebab-case or PascalCase
- [ ] Pre-commit ran `lint-staged` (Prettier + ESLint on staged files only) —
  do not skip hooks with `--no-verify` for format/lint failures
