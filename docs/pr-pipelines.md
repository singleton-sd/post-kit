# PR pipelines

## Workflows

| Workflow | Triggers | Checks |
| --- | --- | --- |
| `ci.yml` | every pull request; every push to `main` | prettier check, eslint, worktree-path tests, PR automation tests, recursive package test/build |
| `release.yml` | push to **`main`** / `workflow_dispatch` | Path-aware version bumps + CHANGELOG commit to `main` via singleton-release App; OIDC `npm publish` (Trusted Publishing); tags + GitHub Releases for `@singleton-sd/post-kit-*` |
| `validate-email-domain-branding.yml` | daily 06:00 UTC; `workflow_dispatch`; pushes to `main` under `packages/post-kit-email/**`, this workflow file, root `package.json`, `pnpm-lock.yaml`, or `infra/appconfig-seed.json` | Live SPF/DKIM/DMARC/BIMI check. Reads `app:email:validation:*` from App Configuration with `--auth-mode login`. Skips (success) when Azure repository Variables are missing, the store is missing, or `app:email:validation:domain` is unset. Failed OIDC federation fails the job. Not required on PRs. |
| `deploy-api.yml` | `main` path changes under `apps/api/**`, `packages/post-kit-email/**`, `infra/function-app.bicep`, `infra/appconfig-seed.json`, `.github/workflows/deploy-api.yml`; also `workflow_dispatch` | OIDC → bicep + App Config seed-if-absent + zip deploy; skips Azure if `AZURE_*` Variables are missing |

There is **no** `pr-hygiene.yml` or `bootstrap-issue-labels.yml`. Do not add
label-only GitHub Actions for this repository.

There are **no preview environments in v1**. Do not add SWA/ACA/Chromatic
preview workflows until a later epic owns them.

Branch naming is `<type>/<issue-number>-<kebab-title>` (e.g.
`feat/1-bootstrap-monorepo`) per section 6 of
[`docs/github-source-of-truth.md`](./github-source-of-truth.md). Create the
matching worktree with `pnpm worktree:add` under the parent workspace
`worktrees/` folder (see `AGENTS.md`). Humans only merge product PRs to
`main`. Solo-repo: do **not** require approving reviews; keep CI green before
merge. `release.yml` pushes release commits to `main` with the
**singleton-release** GitHub App, which must be on the ruleset bypass list
(see `SETUP.md` §1). Default-branch rulesets must not target `refs/tags/**`.

On **`main`**, `release.yml` computes the next version for changed public
packages from the latest per-package tag plus conventional commits since then
(`fix`→patch, `feat`→minor, `BREAKING CHANGE`→major), writes those versions
into package.json, prepends `CHANGELOG.md`, commits
`chore: Release package versions [skip ci]`, and pushes that commit plus
tags using the **singleton-release** App token (`vars.RELEASE_APP_ID` +
`secrets.RELEASE_APP_PRIVATE_KEY`; never `GITHUB_TOKEN` for the push). It
then publishes to npmjs via **Trusted Publishing (OIDC)** (job-level
`id-token: write`; no `NPM_TOKEN`) and creates matching **GitHub Releases**
with generated notes (`scripts/github-releases.mjs`). Loop prevention is the
commit message, not the actor. A retry with no new bump still publishes
missing npm versions and GitHub Releases for tags that already point at HEAD.
With an empty workspace (no `@singleton-sd/post-kit-*` packages yet) it logs
`Nothing to release` and exits 0.

### Backfill existing tags (one-shot)

Tags created before GitHub Releases were enabled can be backfilled with:

```bash
(
  set -e
  for tag in $(git tag -l '@singleton-sd/*'); do
    gh release view "$tag" >/dev/null 2>&1 && continue
    gh release create "$tag" --verify-tag --generate-notes --title "$tag" --notes "Backfilled from existing tag."
  done
)
```

## Secrets / config for pipelines (locked)

| Allowed in GitHub | Forbidden in GitHub |
| --- | --- |
| Variables: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` (IDs) | Any secret: connection strings, passwords, client secrets, `AZURE_CREDENTIALS` |
| Variable `RELEASE_APP_ID` + secret `RELEASE_APP_PRIVATE_KEY` (singleton-release App; push + GitHub Releases) | Provider API tokens, PATs, `NPM_TOKEN` |

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

A sample **consumer-repository** workflow using this OIDC pattern to publish
email templates lives at
[`examples/publish-email-templates.yml`](./examples/publish-email-templates.yml).
It is documentation only and is not installed in this repository's
`.github/workflows/` — see
[`guides/template-publishing.md`](./guides/template-publishing.md).

### Node version

CI uses **Node 24**. Prefer upgrading actions over setting
`ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION`.

Secrets live in **Key Vault** `ssd-postkit-kv-prod-ae` (preferred; see
`SETUP.md` §5). Subscription ID is a GitHub Variable — do not invent a GUID.

## Root scripts

```bash
pnpm format:check   # Prettier
pnpm format
pnpm lint           # recursive package lint (no-op if empty) + root ESLint
pnpm test           # worktree-path + PR automation tests, then recursive package test
pnpm build          # recursive package build (no-op if empty)
pnpm validate:email-domain-branding  # live DNS/HTTPS branding check (optional locally)
```

## PR readiness (no label pipeline)

A PR is ready for human merge when it is mergeable, `Lint / test / build` is
green, and there are no unresolved review threads. `gh pr view` and
`gh pr checks` cover mergeability and CI only. Also paginate
`PullRequest.reviewThreads` and require every `isResolved` to be true:

```bash
gh pr view <n> --json mergeable,mergeStateStatus,statusCheckRollup
gh pr checks <n>
gh api graphql --paginate -f query='
query($endCursor: String) {
  repository(owner: "singleton-sd", name: "post-kit") {
    pullRequest(number: <n>) {
      reviewThreads(first: 100, after: $endCursor) {
        nodes { isResolved }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}'
```

Conflicts: follow the playbook below. Failed CI: fix and push. Review
comments: reply in-thread after the fix is on the branch. Do not add
Actions that set `needs-rebase` / `ci-failed` / `has-feedback` /
`ready-for-human`.

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
| Generated skill dirs | Leave untracked (gitignore) |
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

## Optional local handoff check

`pnpm pr:gate -- --pr <n>` is an optional local readiness check
(`scripts/pr-handoff-gate.mjs`). It is **not** part of required CI and does
not apply labels in the default agent workflow. Prefer `gh pr checks` and
unresolved-thread inspection. Do not add a `pr-handoff-gate` required status
on `main`.
