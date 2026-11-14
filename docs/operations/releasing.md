# Releasing PostKit packages

How `@singleton-sd/post-kit-*` versions are computed and published. Describes the
automation as implemented in `.github/workflows/release.yml` and
`scripts/release-changed.mjs`.

On merge to `main`, the Release workflow commits version bumps and
`CHANGELOG.md`, pushes that commit plus tags with the **singleton-release**
GitHub App, then publishes to npmjs and creates GitHub Releases.

Consumer install / semver guidance:
[`guides/packages.md`](../guides/packages.md). Pipeline overview and secrets
policy: [`pr-pipelines.md`](../pr-pipelines.md). Human npm gates:
[`SETUP.md`](../../SETUP.md).

## What triggers a release

| Trigger | Behavior |
| --- | --- |
| Push to **`main`** whose subject does **not** start with `chore(release):` | Runs `release.yml` |
| `workflow_dispatch` | Same job, manual (also used to reconcile missing npm / GitHub Releases) |

The `chore(release): Release package versions [skip ci]` commit does **not**
re-run the job. Loop prevention is that commit message, not the GitHub actor.

The job:

1. Fails closed if `vars.RELEASE_APP_ID` or `secrets.RELEASE_APP_PRIVATE_KEY`
   is missing. It never falls back to `GITHUB_TOKEN` for the push.
2. Mints an installation token for the **singleton-release** GitHub App
   (`actions/create-github-app-token`, owner `singleton-sd`).
3. Checks out `main` with that token (`fetch-depth: 0`,
   `persist-credentials: false`). The authenticated remote is set only in the
   release step, after install.
4. Installs with **pnpm 9.15.0** (must match root `packageManager`) and **Node 24**.
5. Upgrades the runner to **npm 11** for Trusted Publishing (OIDC).
6. Runs `pnpm release:ci` (`node scripts/release-changed.mjs --ci`).

If nothing needs a bump, the script logs `Nothing to release` (after
reconciling tags already at HEAD) and the workflow exits successfully.

## Which packages are released

Every workspace package whose name starts with `@singleton-sd/post-kit-` and is
not private. Today that is:

- `@singleton-sd/post-kit-types`
- `@singleton-sd/post-kit-email`
- `@singleton-sd/post-kit-compiler`
- `@singleton-sd/post-kit-client`
- `@singleton-sd/post-kit-publisher`
- `@singleton-sd/post-kit-editor`

Each package bumps **independently** when it has releasable conventional commits
since its last reachable `@scope/name@version` tag (path-aware: only commits that
touch that package’s paths count). The next version is the max of `package.json`
and the last tag, then incremented. Bump rules:

| Conventional commit | Increment |
| --- | --- |
| `fix:` / `perf:` | patch |
| `feat:` | minor |
| `BREAKING CHANGE` footer or `type!:` / `type(scope)!:` | major |

After planning bumps, CI:

1. Writes the new version into each package.json. Committed versions are what
   `pnpm publish` uses to rewrite `workspace:*`.
2. Prepends a dated section to `CHANGELOG.md`.
3. Commits `chore(release): Release package versions [skip ci]`.
4. Pushes **HEAD:main** and annotated tags
   (`refs/tags/@singleton-sd/post-kit-*@x.y.z`) with the App token.
5. Publishes changed packages to **npmjs** via **Trusted Publishing (OIDC)** —
   job-level `permissions: id-token: write`; **no `NPM_TOKEN`**.
6. Creates **GitHub Releases** per tag with `gh release create --generate-notes`
   (`scripts/github-releases.mjs`).

Commit and tags are pushed **before** publish so a later retry cannot bind an
already-published version to a newer HEAD. A retry with no new bump republishes
any tag-at-HEAD still missing on npm and creates missing GitHub Releases.

## Contributor requirements (so a release is correct)

For product PRs that should affect published packages:

1. Use conventional commit subjects that match the intended bump (`feat`,
   `fix`, `perf`, or a breaking marker when the public API breaks).
2. Touch only the package(s) that own the change; path filtering drives bumps.
3. Keep hub churn minimal (`pnpm-lock.yaml` only via `pnpm install`, etc. — see
   `AGENTS.md`).
4. Do **not** hand-edit package versions for release; the Release workflow owns
   version numbers.

Humans merge PRs. Merging to `main` is what starts the release path.

## Maintainer checklist

Before relying on automated publish:

1. npmjs org access for `@singleton-sd`.
2. Per-package **Trusted Publisher** (GitHub Actions): org `singleton-sd`,
   repository `post-kit`, workflow filename `release.yml`, allowed action
   `npm publish` — details in [`SETUP.md`](../../SETUP.md).
3. After OIDC publish works: npm **Publishing access → Require 2FA and disallow
   tokens** (human setting on each package).
4. Install the **singleton-release** GitHub App on this repository. Set
   `RELEASE_APP_ID` (variable) and `RELEASE_APP_PRIVATE_KEY` (secret). Put that
   App on the main ruleset **bypass list**. Do not add a PAT or GitHub Actions
   as a bypass actor.
5. Default-branch rulesets (required PR, CodeRabbit, status checks) may stay
   on. They must **not** apply to `refs/tags/**`.

After a release run:

1. Confirm the Release workflow succeeded.
2. Confirm the release commit is on `main`, each intended tag exists, and each
   has a GitHub Release.
3. Spot-check npm (`npm pack @singleton-sd/<pkg>@<version>` or the registry
   version URL) if anything looks off.

## Authentication (no tokens in GitHub Secrets except the App key)

npm publish uses **GitHub Actions OIDC → npm Trusted Publishing**. Do not add
`NPM_TOKEN` / `NODE_AUTH_TOKEN` or Key Vault publish secrets for this path.

The workflow sets `permissions: {}` at the workflow level (deny by default)
and grants the release job:

| Permission | Why |
| --- | --- |
| `contents: read` | Checkout metadata on `GITHUB_TOKEN` (the App token does the writes) |
| `id-token: write` | npm Trusted Publishing (OIDC) |

Push, tags, and `gh` use the singleton-release installation token. The job
fails if `RELEASE_APP_ID` or `RELEASE_APP_PRIVATE_KEY` is unset.

App/runtime secrets (API keys, provider credentials) stay in Azure Key Vault
and are unrelated to package publish. Do not document or paste credentials
here — follow [`pr-pipelines.md`](../pr-pipelines.md).

## Out of scope for agents

- Agents **never** merge PRs to `main`.
- Agents **never** publish to npm interactively and **never** run
  `pnpm release:ci` against production as a substitute for the workflow.
- Agents open PRs with `Closes #N`; humans merge; releases follow from `main`.
