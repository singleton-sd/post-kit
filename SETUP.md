# SETUP - human checklist

## 1. GitHub

- [x] Repo exists: `https://github.com/singleton-sd/post-kit` (public)
- [ ] Branch protection on `main` (solo-repo policy — see below)
- [ ] Optional ruleset for `<type>/*` branch naming (see below)
- [ ] Connect repo in [Cursor Integrations](https://cursor.com/dashboard/integrations)

### Solo-repo branch protection (locked)

This is a solo GitHub identity repo. GitHub forbids self-approve, so do not
require approving reviews.

**Protect `main`:**

1. Open the repo → **Settings** → **Rules** → **Rulesets** (or classic **Branches**).
2. Block force pushes and deletions on `main`.
3. Do not require approving reviews (blocks the same human/AI identity that authored the PR).
4. **Human merge only** for product PRs — agents never merge or review other
   agents' work. Connected review bots leave PR comments; the human validates
   the test plan and merges after CI is green.
5. **Release exception:** `release.yml` must push `chore: Release…` commits
   (version bumps + tags) directly to `main` via `GITHUB_TOKEN`. Classic
   required-PR / required-status-check rules reject that push (`GH006`).
   Repo-level rulesets also cannot list the GitHub Actions integration as a
   bypass actor unless configured at the **organization** ruleset layer
   (`admin:org`). Until an org ruleset requires PR + `Lint / test / build` for
   humans and lists **GitHub Actions** as a bypass actor for `release.yml`
   only, keep those two classic requirements **off** so Release can succeed.

   **Process vs GitHub enforcement:** Product changes still land only via
   human-merged PRs after `Lint / test / build` is green — agents never push
   to `main`, and humans must not merge red CI. What is disabled is only
   GitHub’s *server-side* “required check / required PR” gate (so the Release
   bot’s direct push is not `GH006`). Preferred end state: org ruleset that
   requires PR + `Lint / test / build` for humans, with **GitHub Actions** as
   a bypass actor for `release.yml` only.

### Branch naming (agents + optional GitHub rules)

**Convention (primary — agents follow the "GitHub-native engineering workflow" section of `AGENTS.md`):**

```text
<type>/<issue-number>-<kebab-title>
```

Example: `feat/1-bootstrap-monorepo`. `<type>` is a conventional-commit
prefix (`feat`, `fix`, `docs`, `chore`, `refactor`, `test`, etc.).

**Workspace layout (locked):** open a parent folder that contains the clone
and issue worktrees:

```text
post-kit/                 <-- open this
  main/                   <-- git clone, stays on main
  worktrees/<issue>-<slug>/
```

Create worktrees with `pnpm worktree:add -- -Issue <n> -Type <type> -Slug <kebab>`
(Windows/PowerShell) or `./scripts/add-worktree.sh --issue <n> --type <type> --slug <kebab>`
(macOS / Linux / Docker / Cloud — see `AGENTS.md`). The parent folder can live
anywhere on any OS. Do not create `post-kit-wt-*` siblings next to other projects.

**Where to click in GitHub (optional enforcement):**

1. Open the repo → **Settings** → **Rules** → **Rulesets**.
2. **Protect `main`:** as above (CI + human merge; no required approvals).
3. **Optional branch-name restriction (all branches):** New ruleset whose
   target is **All branches**, not `refs/heads/feat/*` (that include list
   only applies rules to matching names; it never rejects `foo/bar`).
   Enable **Restrict branch names** → **Must match a given regex pattern**:

   ```text
   ^(main|(feat|fix|docs|chore|refactor|test)/[1-9][0-9]*-[a-z0-9]+(?:-[a-z0-9]+)*)$
   ```

   That permits `main` and `<type>/<issue-number>-<kebab-title>` and blocks
   other names at create/rename. Do **not** add a GitHub Actions workflow
   to validate `github.head_ref` — agents follow `AGENTS.md`; humans merge.
4. Ensure PRs into `main` come from those branches only (agents never merge; humans merge).

## 2. GitHub Issues

Engineering work is tracked in **GitHub Issues** in this repo — see
`docs/github-source-of-truth.md` and the "GitHub-native engineering workflow"
section of `AGENTS.md`. The GitHub Project view is documented in
`docs/github-project.md`.

This repository has no ClickUp engineering integration. Do not file
engineering work in ClickUp.

## 3. Agent skills (marketplace — do not copy SKILL.md)

Skills are owned by
[`singleton-sd/ai-plattform-skills`](https://github.com/singleton-sd/ai-plattform-skills).
Do not vendor copies into this repo.

```bash
pnpm sync:skills
```

Equivalent:

```bash
npx skills add singleton-sd/ai-plattform-skills \
  --skill task-driven-development \
  --skill backend \
  --skill frontend \
  -a cursor -a claude-code -a grok -a codex \
  --copy \
  -y
```

- [ ] Run `pnpm sync:skills` after clone / worktree bootstrap (Cursor, Claude
      Code, Grok, Codex)

## 4. Agent automations

- [ ] Implementer: pick an agent-ready GitHub Issue → branch/worktree + open PR
      (`Closes #N`) is the claim. Required CI is `Lint / test / build`.
- [ ] Review bots: inspect open PRs and leave findings on GitHub; agents do
      not review other agents' work. Agents address comments on their own PRs.
- [ ] Human: follow the PR test plan, leave feedback, and merge only after CI
      and actionable bot findings are resolved — merging closes the linked
      issue automatically
- There is **no** PR-hygiene or issue-label bootstrap workflow. Lifecycle
  labels (`agent-ready`, `blocked`, `needs-requirements`) are created once
  by a human/`gh` if missing; they are not toggled by Actions.

## 5. Azure (dedicated PostKit subscription)

**Target (locked):**

| Item | Value |
| --- | --- |
| Entra tenant | `9a0e57d7-e58e-4e8b-814d-037cd7d9015c` (shared with platform-kit) |
| Subscription **display name** | `SSD Post Kit` (docs short name: `ssd-post-kit`) |
| Subscription **ID** | `9b6fc2b1-064a-4eb2-81fe-0aa8c7c751b5` |
| Resource group | `rg-postkit-prod-ae` (region: Australia East) |
| Key Vault (preferred) | `ssd-postkit-kv-prod-ae` in the PostKit RG/sub |

**Do not** deploy PostKit into the platform-kit PoC subscription
(`7b8343d7-969f-4b71-8864-b7925e7fae30`) or keep long-term targets on the
legacy Singleton SD global RG (`rg-ssd-global` /
`01c0bb8b-3770-4765-979a-cb13ae7e3dd2`). Those IDs remain documented only as
historical context until cutover completes.

### Resources (provisioned in `rg-postkit-prod-ae`)

| Kind | Name | Notes |
| --- | --- | --- |
| Resource group | `rg-postkit-prod-ae` | Dedicated PostKit RG in `ssd-post-kit` |
| Function App | `ssd-postkit-api-prod-ae` | Contact/send API |
| App Service Plan | `ssd-postkit-plan-prod-ae` | **Y1** Linux Consumption (still viable on a dedicated sub) |
| Storage | `ssdpostkitstprodae` | Function App storage |
| App Configuration | `ssd-postkit-appcs-prod-ae` | **Free** SKU — see limits below |
| Key Vault | `ssd-postkit-kv-prod-ae` | Preferred: new vault in this subscription |

### Free App Configuration limits (accurate)

Free tier (per [Microsoft docs](https://learn.microsoft.com/en-us/azure/azure-app-configuration/faq)):

- **3 Free stores per region per subscription** — a dedicated PostKit sub keeps
  headroom; do not consume Free slots in shared/platform subscriptions.
- **1,000 requests per store per day** — after quota, HTTP 429 until midnight UTC.
- **10 MB** configuration storage (+ 10 MB snapshot storage).
- No guaranteed throughput.

Upgrade to Developer/Standard only if request volume or store count requires it.
Y1 Consumption Function Apps remain the cost default for the API.

### Key Vault

**Production:** `ssd-postkit-kv-prod-ae` in `rg-postkit-prod-ae` (same
subscription as the Function App). Bicep creates this vault with RBAC
authorization enabled. Secrets `forwardemail-api-key` and
`recipient-hash-hmac-key` live here.

**Legacy note:** an older shared vault `ssd-global-kv-prod-ae` on Singleton SD
is no longer the PostKit production target. Do not pass that name into this
template with `createKeyVault=true`. See [`infra/README.md`](infra/README.md)
for same-RG `createKeyVault=false` only.

### Secrets + configuration (locked)

| Layer | Store | Rule |
| --- | --- | --- |
| **Secrets** | Azure Key Vault `ssd-postkit-kv-prod-ae` | Tokens, connection strings. Never in git or GitHub Actions secrets. |
| **App configuration** | Azure App Configuration `ssd-postkit-appcs-prod-ae` | Non-secret settings, including branding keys, + **Key Vault references** for secret values. |
| **CI/CD** | GitHub Actions **OIDC** → Azure | Workflows log in with federated creds, then at job runtime: `az appconfig kv show` / `az keyvault secret show`. Mask secret values; never print them. |

**GitHub Actions — allowed identifiers only (repository Variables, not Secrets):**

| Variable | Purpose | Expected value |
| --- | --- | --- |
| `AZURE_CLIENT_ID` | OIDC app registration **application (client) ID** — a UUID, **not** the display name | Resolve with `az ad app list --display-name ssd-pocpk-gha-oidc-dev --query [].appId -o tsv` (or a PostKit-dedicated app’s `appId`). `azure/login` `client-id` rejects names. |
| `AZURE_TENANT_ID` | Entra tenant ID | `9a0e57d7-e58e-4e8b-814d-037cd7d9015c` |
| `AZURE_SUBSCRIPTION_ID` | PostKit subscription ID | `9b6fc2b1-064a-4eb2-81fe-0aa8c7c751b5` |

**Do not** store connection strings, passwords, deploy tokens, or
`AZURE_CREDENTIALS` in GitHub Secrets.

### Human checklist — subscription, OIDC FIC, GitHub Variables

Agents cannot create Azure **billing** subscriptions. Complete these before
Phase 2 provision/deploy ([#120](https://github.com/singleton-sd/post-kit/issues/120)):

1. [x] **Create** Azure subscription (`SSD Post Kit` /
      `9b6fc2b1-064a-4eb2-81fe-0aa8c7c751b5`) under tenant
      `9a0e57d7-e58e-4e8b-814d-037cd7d9015c` (Portal / EA / MCA as applicable).
2. [x] **Confirm billing** / offer allows Azure Functions (Y1 Consumption) and
      App Configuration **Free**.
3. [x] **Grant access** on the new subscription: operators (Contributor or
      Owner as needed) and the GitHub OIDC service principal. Subscription
      **Contributor alone is not enough** for first deploy: `function-app.bicep`
      creates App Configuration and Key Vault **role assignments**, which need
      `Microsoft.Authorization/roleAssignments/write`. Grant the OIDC principal
      **Contributor** plus **Role Based Access Control Administrator** (or
      **User Access Administrator**) on the target RG/sub — or **Owner** — or
      pre-create those assignments and leave `githubOidcPrincipalId` empty so
      bicep skips the OIDC role resources. Data-plane roles (Key Vault Secrets
      User, App Configuration Data Owner/Reader) still come from bicep when
      that principal id is passed.
4. [x] **OIDC federated credentials** for repo `singleton-sd/post-kit` on the
      Entra app used by Actions (reuse `ssd-pocpk-gha-oidc-dev` or create a
      PostKit-dedicated app). Subjects must match the token `sub` claim, e.g.:
      - `repo:singleton-sd/post-kit:ref:refs/heads/main`
      - `repo:singleton-sd/post-kit:pull_request` (if PR deploys ever need Azure)
      - Plus any **ID-form** subjects GitHub emits
        (`repo:ORG@ORG_ID/REPO@REPO_ID:…`) — see `docs/pr-pipelines.md`.
5. [x] Set GitHub repo **Variables** (Settings → Secrets and variables →
      Actions → Variables): `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`,
      `AZURE_SUBSCRIPTION_ID` (`9b6fc2b1-064a-4eb2-81fe-0aa8c7c751b5`).
6. [x] **Comment on [#120](https://github.com/singleton-sd/post-kit/issues/120)**
      with the subscription **GUID** (Phase 2 tracker; #116 was Phase 1 docs).
7. [x] After RG/resources exist: put secret **values** into Key Vault names
      `forwardemail-api-key` and `recipient-hash-hmac-key` (portal/CLI — never
      commit values). Branding keys `app:email:validation:*` are seeded on
      first Function deploy.

### Agent work after the subscription ID exists

Tracked as [#120](https://github.com/singleton-sd/post-kit/issues/120)
(Phase 2; Phase 1 docs were #116 / #118):

- [x] Fill subscription GUID into docs
- [x] Ensure `deploy-api.yml` targets `rg-postkit-prod-ae` (defaults already set)
- [x] Create RG; run bicep / Deploy API workflow
- [ ] Verify OIDC login, App Config seed, Function zip deploy
- [x] Place Key Vault secret **values** (copied into `ssd-postkit-kv-prod-ae`;
  PostKit copy of `recipient-hash-hmac-key` removed from legacy global vault)

## 6. npmjs (public packages)

Publishable workspace packages use the `@singleton-sd/post-kit-*` scope and
`"private": false`. The workspace root stays `"private": true` (the monorepo
is not published).

Auth model: **Trusted Publishing (OIDC)** from GitHub Actions — same pattern as
[`engineering/publish-npm-library`](https://github.com/singleton-sd/ai-plattform-skills)
and the live reference
[`poc-inkads-epaper-renderer`](https://github.com/singleton-sd/poc-inkads-epaper-renderer).
Do **not** add `NPM_TOKEN` / `NODE_AUTH_TOKEN` or Key Vault publish secrets.

### Trusted Publisher form (every `@singleton-sd/post-kit-*` package)

On each package → **Settings → Trusted publisher → GitHub Actions**:

| Field | Value |
| --- | --- |
| Organization / user | `singleton-sd` |
| Repository | `post-kit` (name only) |
| Workflow filename | `release.yml` (filename only) |
| Environment | empty |
| Allowed action | **`npm publish`** |

Packages: `types`, `email`, `compiler`, `client`, `publisher`, `editor`.

### Checklist

- [x] npmjs org access for `@singleton-sd`
- [x] Per-package Trusted Publisher configured (form above)
- [x] First versions bootstrapped interactively from clean `main`
      (`pnpm --filter <pkg> build` then `pnpm --filter <pkg> publish --access public`)
- [ ] After the first successful **OIDC CI** publish: Publishing access →
      **Require 2FA and disallow tokens**

### Verify a published version

Prefer the version document or a pack (package-root `npm view` can 404 briefly
after first publish even when the version exists):

```bash
curl -sS "https://registry.npmjs.org/@singleton-sd%2fpost-kit-types/0.3.0" | head
npm pack @singleton-sd/post-kit-types@0.3.0
```

`release.yml` uses the root `packageManager` pnpm version + npm 11.x, refuses
auth-bearing `.npmrc` files (no `registry-url` on `setup-node`), and runs
`pnpm release:ci`, which publishes changed packages **before** pushing tags.
`publishConfig.provenance: true` is for CI OIDC only — local interactive
publish may need it omitted temporarily.
