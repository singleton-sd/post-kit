# PR pipelines

## Path filters

| Workflow | Triggers when paths change | Checks |
| --- | --- | --- |
| `ci.yml` | `apps/**`, `packages/**`, `scripts/**`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.prettierrc`, `.prettierignore`, `eslint.config.js`, `.github/workflows/ci.yml` | prettier check, eslint, worktree-path tests, PR automation tests, recursive package test/build |
| `release.yml` | push to **`main`** (skipped for `chore: Release` commits) | Path-aware bumps; commit + tags for `@singleton-sd/post-kit-*` packages |
| `pr-hygiene.yml` | PR events, `main` pushes, `workflow_run` of `CI`, review comments | Labels only (`needs-rebase`, `ci-failed`, `has-feedback`, `ready-for-human`) |
| `bootstrap-issue-labels.yml` | push of that workflow on `main`, or `workflow_dispatch` | Ensures `agent-ready` / `blocked` / `needs-requirements` exist |

There are **no preview environments in v1**. Do not add SWA/ACA/Chromatic
preview workflows until a later epic owns them.

Branch naming is `<type>/<issue-number>-<kebab-title>` (e.g.
`feat/1-bootstrap-monorepo`) per section 6 of
[`docs/github-source-of-truth.md`](./github-source-of-truth.md). Create the
matching worktree with `pnpm worktree:add` under the parent workspace
`worktrees/` folder (see `AGENTS.md`). Humans only merge to `main`. Solo-repo:
require CI checks, **not** approving reviews (see `SETUP.md`).

On **`main`**, `release.yml` bumps versions for changed public packages
(conventional commits: `fix`→patch, `feat`→minor, `BREAKING CHANGE`→major).
With an empty workspace (no `@singleton-sd/post-kit-*` packages yet) it logs
`Nothing to release` and exits 0.

## Secrets / config for pipelines (locked)

| Allowed in GitHub | Forbidden in GitHub |
| --- | --- |
| Variables: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` (IDs) | Any secret: connection strings, passwords, client secrets, `AZURE_CREDENTIALS` |
| Built-in `GITHUB_TOKEN` for PR labels and release commits | Provider API tokens |

Flow (later, when Azure workflows exist): **Azure Login (OIDC)** →
`az keyvault secret show` → use value only as a **job env var** (mask in
logs; never a GitHub Secret).

### OIDC subject forms (Entra FIC)

GitHub may emit **ID-form** OIDC subjects such as
`repo:ORG@ORG_ID/REPO@REPO_ID:pull_request` (and the matching
`:ref:refs/heads/main` form). The Entra federated identity credential
**subject must match that `sub` claim exactly**. Classic subjects
(`repo:org/repo:pull_request`) can remain on the app registration for
compatibility when tokens still use them.

OIDC is documented now and provisioned later — see `SETUP.md` human gates.

### Node version

CI uses **Node 24**. Prefer upgrading actions over setting
`ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION`.

Secrets live in **Key Vault** `ssd-global-kv-prod-ae`.

## Root scripts

```bash
pnpm format:check   # Prettier
pnpm format
pnpm lint           # recursive package lint (no-op if empty) + root ESLint
pnpm test           # worktree-path + PR automation tests, then recursive package test
pnpm build          # recursive package build (no-op if empty)
pnpm pr:gate -- --pr <n>
```

## PR hygiene (conflicts, CI, feedback)

Hygiene workflows set **labels only**. They do not post “fix this” comments.

| Label | Meaning | Cleared when | Agent action |
| --- | --- | --- | --- |
| `needs-rebase` | Merge conflicts with base (`mergeable_state=dirty`) | Mergeability is known and not `dirty` (never cleared while `unknown`) | `git merge origin/main` → take main's lockfile → `pnpm install` → hand-fix leftovers → push → re-check CI |
| `ci-failed` | Required CI job failed (`Lint / test / build`) | That job is no longer `FAILURE` | Fix the required CI cause and push |
| `has-feedback` | Bugbot, Copilot, or human (non-author) comment | PR `synchronize` when no unresolved threads remain | Fetch issue + review comments; address with a threaded reply |
| `preview-blocked` | Reserved; never set in v1 | — | Ignore |
| `ready-for-human` | Mergeable + required CI green + no open feedback | Any of `needs-rebase` / `ci-failed` / `has-feedback` is (re-)added | Nothing — applied by `pnpm pr:gate -- --pr <n>` once the PR clears the other three labels |

```bash
gh pr list --label needs-rebase
gh pr list --label ci-failed
gh pr list --label has-feedback
gh pr list --label ready-for-human
gh pr view <n> --json mergeable,mergeStateStatus,statusCheckRollup
```

Triggers: PR opened/synchronize (dirty check + clear `has-feedback` on sync),
push to `main` (scan open PRs), completed `workflow_run` for `CI` (set/clear
`ci-failed`), issue/review comments from Bugbot/Copilot/collaborators.
Usage-limit and `github-actions` comments are ignored.

A PR is ready for human merge only when mergeable, required lint/test/build
checks are green, and there is no open actionable feedback — signalled by the
`ready-for-human` label.

## Shared hub conflicts (agent playbook)

Do **not** hand-merge `pnpm-lock.yaml`. Prefer merge over rebase. Full hub
ownership table: the **Shared hub files** section of `AGENTS.md`.

```text
1. git fetch origin main
2. git merge origin/main
3. For pnpm-lock.yaml: take main's lock, then pnpm install, then stage
4. Hand-fix only remaining paths
5. Commit the merge, push
6. gh pr checks --watch; confirm mergeable
```

| Path | Mechanical action |
| --- | --- |
| `pnpm-lock.yaml` | Take main → `pnpm install` → stage |
| `**/package.json` | JSON-merge deps/scripts keys from both sides |
| `.cursor/skills/**` | Take main unless this is a skills ticket |
| `AGENTS.md`, `SETUP.md`, `docs/pr-pipelines.md` | Take main unless this is a docs ticket |
| `.env.example` | Union unique `KEY=` lines |

Hand-fix leftovers: `.github/workflows/**`.

## Issue closure (GitHub-native)

There is no separate "mark complete" step. Every PR links its issue with a
closing keyword (`Closes #N`) per
section 6 of [`docs/github-source-of-truth.md`](./github-source-of-truth.md);
a human merging the PR closes the linked issue automatically. Do not add
automation that mirrors GitHub issue/PR state back into a second system
(source-of-truth policy section 2).

## Enforced PR handoff gate

A PR is ready for human review/merge only once it is mergeable, required CI
is green, and there is no open actionable feedback. The gate applies the
GitHub-native `ready-for-human` label:

```bash
pnpm pr:gate -- --pr <pr-number>
```

(`pnpm pr:gate` runs `scripts/pr-handoff-gate.mjs`.) The gate pins the PR head
SHA, requires **required** CI (`Lint / test / build`, `conflict-on-pr`) to
appear and finish successfully, requires a mergeable/non-dirty PR, rejects
`ci-failed` / `has-feedback` / `needs-rebase`, and rejects unresolved review
threads. `preview-blocked` does not fail the gate. Empty check lists and
`UNKNOWN` mergeability fail closed. A reviewer quiet period is optional
(`PR_GATE_QUIET_SECONDS`, default `0`). Override polling with
`PR_GATE_TIMEOUT_SECONDS` and `PR_GATE_POLL_SECONDS`. Pass `--no-label` (or
set `PR_GATE_NO_LABEL=1`) to run the gate as a pure readiness check without
touching the `ready-for-human` label.

Run it after opening the PR and again after every push, before considering
the implementation done. On success it adds `ready-for-human` (creating the
label if needed); on failure/timeout it removes the label and reports the
blockers. There is **no** GitHub `pr-handoff-gate` commit status — do not add
it to the `main` branch protection ruleset; the label is the signal.
