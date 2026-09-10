# Releasing PostKit packages

How `@singleton-sd/post-kit-*` versions are bumped and published. Describes the
automation as implemented in `.github/workflows/release.yml` and
`scripts/release-changed.mjs`.

Consumer install / semver guidance:
[`guides/packages.md`](../guides/packages.md). Pipeline overview and secrets
policy: [`pr-pipelines.md`](../pr-pipelines.md). Human npm gates:
[`SETUP.md`](../../SETUP.md).

## What triggers a release

| Trigger | Behavior |
| --- | --- |
| Push to **`main`** | Runs `release.yml` unless the head commit subject starts with `chore: Release` (avoids loops) |
| `workflow_dispatch` | Same job, manual |

The job:

1. Checks out `main` with full history.
2. Installs with **pnpm 9.15.0** (must match root `packageManager`) and **Node 24**.
3. Upgrades the runner to **npm 11** for Trusted Publishing (OIDC).
4. Runs `pnpm release:ci` (`node scripts/release-changed.mjs --ci`).

If nothing needs a bump, the script logs `Nothing to release` and the workflow
exits successfully.

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
touch that package’s paths count). Bump rules:

| Conventional commit | Increment |
| --- | --- |
| `fix:` / `perf:` | patch |
| `feat:` | minor |
| `BREAKING CHANGE` footer or `type!:` / `type(scope)!:` | major |

After bumps, CI:

1. Commits `chore: Release package versions` on `main` (local).
2. Publishes changed packages to **npmjs** via **Trusted Publishing (OIDC)** —
   `permissions: id-token: write`; **no `NPM_TOKEN`**.
3. Pushes the release commit, then annotated tags, then creates **GitHub
   Releases** per tag (`scripts/github-releases.mjs`).

Publish runs **before** pushing tags so an auth failure does not leave orphan
tags on `origin/main`.

## Contributor requirements (so a release is correct)

For product PRs that should affect published packages:

1. Use conventional commit subjects that match the intended bump (`feat`,
   `fix`, `perf`, or a breaking marker when the public API breaks).
2. Touch only the package(s) that own the change; path filtering drives bumps.
3. Keep hub churn minimal (`pnpm-lock.yaml` only via `pnpm install`, etc. — see
   `AGENTS.md`).
4. Do **not** hand-edit package versions for release; the Release workflow owns
   version numbers on `main`.

Humans merge PRs. Merging to `main` is what starts the release path.

## Maintainer checklist

Before relying on automated publish:

1. npmjs org access for `@singleton-sd`.
2. Per-package **Trusted Publisher** (GitHub Actions): org `singleton-sd`,
   repository `post-kit`, workflow filename `release.yml`, allowed action
   `npm publish` — details in [`SETUP.md`](../../SETUP.md).
3. After OIDC publish works: npm **Publishing access → Require 2FA and disallow
   tokens** (human setting on each package).
4. Branch protection must allow the Release workflow’s intentional direct push
   of `chore: Release…` to `main` (see `SETUP.md` / `pr-pipelines.md`).

After a release commit lands:

1. Confirm the Release workflow succeeded.
2. Confirm each intended tag exists and has a GitHub Release.
3. Spot-check npm (`npm pack @singleton-sd/<pkg>@<version>` or the registry
   version URL) if anything looks off.

## Authentication (no tokens in GitHub Secrets)

npm publish uses **GitHub Actions OIDC → npm Trusted Publishing**. Do not add
`NPM_TOKEN` / `NODE_AUTH_TOKEN` or Key Vault publish secrets for this path.

App/runtime secrets (API keys, provider credentials) stay in Azure Key Vault
and are unrelated to package publish. Do not document or paste credentials
here — follow [`pr-pipelines.md`](../pr-pipelines.md).

## Out of scope for agents

- Agents **never** merge PRs to `main`.
- Agents **never** publish to npm interactively and **never** run
  `pnpm release:ci` against production as a substitute for the workflow.
- Agents open PRs with `Closes #N`; humans merge; releases follow from `main`.
