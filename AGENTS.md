# AGENTS.md - post-kit

## Engineering source of truth (read first)

**[`docs/github-source-of-truth.md`](docs/github-source-of-truth.md) is the
authoritative policy** for engineering system ownership, the engineering
lifecycle, agent-ready criteria, issue dependency/parallel-execution rules,
issue/branch/worktree/PR relationships, and the public-repository safety
boundary. Read it before starting new engineering work.

**All engineering work uses the [GitHub-native engineering
workflow](#github-native-engineering-workflow) section below.** GitHub Issues
are the work identifier. This repository has no ClickUp engineering
integration.

## Repo

- GitHub: `singleton-sd/post-kit` (`git@github.com:singleton-sd/post-kit.git`)
- Public repository — see **Public-repo safety** below
- Local parent workspace: `post-kit/` (clone in `main/`, issue worktrees in
  `worktrees/` — see Worktree bootstrap)

## GitHub-native engineering workflow

This section implements [`docs/github-source-of-truth.md`](docs/github-source-of-truth.md)
sections 3, 5, and 6 operationally. Read the policy document for the full rules;
this is the "how" for day-to-day agent execution.

### Finding and claiming work

1. Work is a **GitHub Issue** in `singleton-sd/post-kit`. The issue
   number (`#N`) is the work's identity — do not invent a parallel id.
2. An issue is **agent-ready** only when it meets every condition in
   `docs/github-source-of-truth.md` section 4 (clear goal, scope, acceptance
   criteria, stated constraints, no unresolved open questions) **and** has no
   unresolved `Depends on:` line (section 5). An issue lacking any of that is
   discovery/refinement work, not implementation work — do not start coding
   from it.
3. **Claiming is implicit and exclusive by construction:** an agent claims an
   issue simply by creating a branch/worktree for it and opening a PR against
   it. There is no separate claim-token step. **First linked open PR wins.**
   Before starting, search `is:pr is:open <issue-number> in:body` (and the
   issue's "linked pull requests"). If a linked open PR already exists, stop
   immediately — do not create a second branch, worktree, or PR. If two
   agents race, the later agent closes its PR with a comment pointing at the
   first PR. If you must abandon claimed work, close your PR (or leave a
   comment saying so) so the issue reads as unclaimed again.
4. Check `Depends on:` / `Blocks:` / `Parent:` lines on the issue (see
   `docs/github-source-of-truth.md` section 5):
   - An unresolved `Depends on: #N` (issue `#N` not yet closed) means **do
     not start** — the issue is not agent-ready yet.
   - Issues with no dependency relationship between them may be worked
     concurrently in separate worktrees/branches, provided their expected
     file sets do not substantially overlap (see **Shared hub files**
     below).
   - Never build on another agent's unmerged branch unless the issue
     explicitly declares that dependency. Always start from `origin/main`.
   - A `Parent: #N` issue is a tracking/umbrella issue, not itself a unit of
     implementation — its children are the actual work.

### Branch naming

```text
<type>/<issue-number>-<kebab-title>
```

Examples: `feat/1-bootstrap-monorepo`, `fix/12-login-redirect`,
`docs/8-github-engineering-source-of-truth`.

`<type>` is a conventional-commit-style prefix (`feat`, `fix`, `docs`,
`chore`, `refactor`, `test`, etc.) matching the primary nature of the
change.

### Worktree bootstrap (required)

**Layout (locked):** open a **parent workspace** folder in your editor, not
the git clone.

```text
post-kit/                 <-- open this
  main/                   <-- git clone, stays on main
  worktrees/<issue>-<slug>/
```

Example: `~/src/post-kit/main` +
`~/src/post-kit/worktrees/1-bootstrap-monorepo`.

- Worktree folder name = `<issue-number>-<kebab-title>` (branch name without
  the `<type>/` prefix).
- Create every worktree from `origin/main` only, via the helper (do not
  invent sibling `*-wt-*` paths or in-repo `.worktrees/`):

```powershell
pnpm worktree:add -- -Issue 1 -Type feat -Slug bootstrap-monorepo
```

macOS / Linux / Docker / Cloud:

```bash
./scripts/add-worktree.sh --issue 1 --type feat --slug bootstrap-monorepo
```

(`add-worktree.sh` is plain bash and runs unchanged on macOS; Alpine-based
containers need `apk add bash` first since the script uses bash arrays, not
available under `sh`/`dash`.)

- Then bootstrap dependencies once (the helper runs this unless
  `-SkipBootstrap`/`--skip-bootstrap`):

```bash
pnpm bootstrap:worktree
pnpm bootstrap:worktree:quick   # install + pnpm test:worktree-paths
```

Rationale: worktrees do not share dependencies reliably on Windows;
installing per worktree prevents child-agent stalls from missing
`node_modules`. Do not use manual cross-worktree `node_modules` symlinks.

- Every implementer subagent must use its own worktree.
- Never share a dirty `main` working tree across parallel agents.
- Remove the worktree when the PR is merged or the run is abandoned:

```bash
git worktree remove ../worktrees/<issue-number>-<kebab-slug>
git worktree prune
```

### Repository workflow (fetch, rebase, push, PR)

Per `docs/github-source-of-truth.md` section 6:

1. Never work directly on `main`.
2. `git fetch origin` before starting.
3. Create the branch/worktree from `origin/main` (above).
4. Implement. Do not incorporate another agent's unmerged branch unless the
   issue explicitly declares that dependency.
5. Before pushing completed implementation:
   - `git fetch origin`
   - rebase (or merge, per the **Shared hub files / conflict playbook**
     below) onto `origin/main`
   - resolve conflicts
   - run the relevant test suite
6. Push with `--force-with-lease` after a rebase. Never plain `--force`.
7. Open/update the PR with a GitHub closing keyword linking the issue:

   ```text
   Closes #1
   ```

   Use `Closes`/`Fixes`/`Resolves`, not a plain `#1` reference, so merging
   closes the issue automatically.
8. If `origin/main` changes while CI/review is running and branch
   protection or mergeability requires it, rebase again and re-push
   (`--force-with-lease`).
9. Humans merge. Agents never approve or merge their own PRs (GitHub
   forbids self-approval on a solo identity anyway).

### Review feedback

Connected review bots (e.g. Cursor Bugbot, ChatGPT Codex Connector) review
PRs on GitHub; humans may also comment.

1. After pushing, watch required CI in-session (`gh pr checks --watch`).
   Required check: `Lint / test / build`.
2. There is **no** PR-hygiene or issue-label GitHub Actions workflow. Poll
   mergeability, CI, and review comments with `gh` (`gh pr view`, `gh pr
   checks`, GraphQL review threads).
3. Conflicts: follow the conflict playbook. Failed CI: fix and push.
   Review comments: fetch issue + review comments and reply in-thread once
   resolved (or after the fix is pushed).
4. A PR is ready for human merge when it is mergeable, `Lint / test / build`
   is green, and there are no unresolved review threads. Do not wait on a
   `ready-for-human` label — that pipeline is not used here.
5. Bot or human feedback that requires code changes: fetch the PR tip and
   all feedback, make the change, push. There is no separate ticket status
   to move — the PR itself is the state.

### Completion

Merging the PR (with `Closes #N`) closes the linked issue automatically.
There is no separate "mark complete" step — see the "Issue closure" section
of [`docs/pr-pipelines.md`](docs/pr-pipelines.md).

## Solo-repo merge (locked)

Branch protection must require **CI status checks** + **human merge**, but
must not require approving reviews. Connected review bots provide comments
and agents never approve. See `SETUP.md`.

## Shared hub files (conflict prevention)

Parallel PRs collide on shared hub paths. **Do not touch a hub unless the
ticket requires it.**

| Hub | Touch only when | Notes |
| --- | --- | --- |
| `pnpm-lock.yaml` | Dep change via `pnpm install` | Never hand-edit; never line-merge |
| Root `package.json` / `pnpm-workspace.yaml` | Root tooling ticket | Prefer deps/scripts in `apps/*`, `packages/*` |
| Workspace `**/package.json` | That package's ticket | Keep diffs minimal |
| `.cursor/skills/**` | Dedicated skills ticket | Do not mix skills edits into feature PRs |
| `AGENTS.md`, `SETUP.md`, `docs/pr-pipelines.md` | Docs/ops issue | Otherwise open a GitHub issue as a follow-up |
| `.github/workflows/**` | CI/CD ticket | - |
| `.env.example` | New env keys required by ticket | Add keys only; no secrets |

### Conflict playbook (mandatory on dirty / `needs-rebase`)

Agents must not reason through lockfiles. Prefer **merge** over rebase
(simpler ours/theirs):

```text
1. git fetch origin main
2. git merge origin/main
3. For pnpm-lock.yaml: take main's lock, then pnpm install, then stage
4. Hand-fix remaining paths (package.json, workflows, docs)
5. Commit the merge, push
6. gh pr checks --watch; confirm mergeable
```

| Conflict path | Action |
| --- | --- |
| `pnpm-lock.yaml` | Take main's lock → `pnpm install` → stage |
| Any `package.json` | Merge `dependencies` / `devDependencies` / `scripts` (both sides' keys) |
| `.cursor/skills/**` | Take main unless this is a skills ticket |
| Docs hubs above | Take main unless this is a docs ticket |
| `.env.example` | Union unique `KEY=` lines |

**Hand-fix leftovers:** `.github/workflows/**`, root docs when both sides
changed meaningfully.

Ops tip: merge foundation/hub PRs (CI, hooks, SETUP) before long-lived
feature PRs when possible.

## Architecture

Narrative overview: [`docs/architecture/overview.md`](docs/architecture/overview.md).

- **API:** Azure Functions in `apps/api` (contact/send; not in this bootstrap)
- **Packages:** public npm `@singleton-sd/post-kit-*` under `packages/`
  (first: `post-kit-email`; later client, editor, types, compiler, publisher)
- Consumers call PostKit from trusted server-side code. Browser code must
  never contain long-lived PostKit credentials.
- **Secrets:** Azure Key Vault only (`ssd-global-kv-prod-ae`)
- **CI/CD:** GitHub Actions **OIDC** → Azure → Key Vault (no deploy tokens
  or connection strings in GitHub Secrets)
- **Cost + naming:** Function App Consumption (Y1); planned names in `SETUP.md`

## Testing

Wave A (this bootstrap) uses Node's built-in test runner for repo scripts:

```bash
pnpm test:worktree-paths    # node scripts/worktree-paths.test.mjs
pnpm test:pr-automation     # pr-handoff-gate + invoke-ps1
pnpm test                   # script tests, then pnpm -r --if-present run test
```

Workspace packages (when they exist) use `node --test` / `tsx` for unit
tests — document the runner in the package and keep it consistent. Prefer
`src/**/*.spec.ts` next to the code.

## Secrets + configuration (locked)

**Subscription:** Singleton SD / `01c0bb8b-3770-4765-979a-cb13ae7e3dd2`

| Concern | Store |
| --- | --- |
| Secrets (tokens, connection strings, provider keys) | Key Vault `ssd-global-kv-prod-ae` |
| Non-secret app settings | Function App settings / later App Configuration |

- **Local:** copy `.env.example` → `.env`. Never commit secrets.
- **CI (GitHub Actions):** OIDC login using repo **Variables**
  `AZURE_CLIENT_ID` / `AZURE_TENANT_ID` / `AZURE_SUBSCRIPTION_ID` (IDs only).
  **Never** put tokens or `AZURE_CREDENTIALS` in GitHub Secrets.
- Agents must not paste secrets into issues, PRs, or git.

## Public-repo safety

This repository is **public**. Anything committed or posted — issues, PR
descriptions and comments, commits, branch names, docs, Actions logs — is
permanently visible.

Never place secrets, customer-private data, contracts, pricing negotiations,
or other commercially sensitive detail in this repo. Keep private business
detail out of this public repository. Write GitHub Issues in generic terms.

## PR pipelines

GitHub Actions (see `docs/pr-pipelines.md` / `SETUP.md`):

| Change set | CI | Preview | Production (`main`) |
| --- | --- | --- | --- |
| Any PR / push to `main` | `ci.yml` (`Lint / test / build`) | None in v1 | `release.yml` bumps public packages |

- Local checks: pre-commit runs Prettier + ESLint on staged files only via
  `lint-staged` (never bypass with `--no-verify` for format/lint). Full-repo
  `pnpm format:check` / `pnpm lint` remain for humans/CI; also `pnpm test`,
  `pnpm build`. Manual staged check: `pnpm lint:staged`.
- Humans only merge; agents open PRs linking their GitHub issue (`Closes #N`).
  There is no hygiene/label pipeline and no `pr:gate` handoff step.

## Skills

Read curated skills under `.cursor/skills/` before coding (`git-conventions`,
`code-review`, `task-driven-development`).

## TDD / quality

- Write failing tests first for behavior changes.
- Public package APIs must be explicit and minimal.
- Packages must not reach into app internals.
