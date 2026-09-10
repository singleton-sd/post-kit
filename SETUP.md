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
   (`admin:org`). Until an org ruleset grants Actions bypass for PR +
   `Lint / test / build`, keep those two requirements **off** on classic
   branch protection so Release can succeed. Process still applies: humans
   open PRs, wait for CI, then merge — agents never push to `main`.

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

## 5. Azure (document only — do not provision in this PR)

**Subscription:** Singleton SD / `01c0bb8b-3770-4765-979a-cb13ae7e3dd2`
**Resource group:** `rg-ssd-global`
**Key Vault:** `ssd-global-kv-prod-ae`

### Planned resources (not created yet)

| Kind | Name | Notes |
| --- | --- | --- |
| Function App | `ssd-postkit-api-prod-ae` | Contact/send API |
| App Service Plan | `ssd-postkit-plan-prod-ae` | Y1 Consumption |
| Storage | `ssdpostkitstprodae` | Function App storage |
| App Configuration | `ssd-postkit-appcs-prod-ae` | **Free** (this subscription has no other Free store); includes branding keys `app:email:validation:*` |

### Secrets + configuration (locked)

| Layer | Store | Rule |
| --- | --- | --- |
| **Secrets** | Azure Key Vault `ssd-global-kv-prod-ae` | Tokens, connection strings. Never in git or GitHub Actions secrets. |
| **App configuration** | Azure App Configuration `ssd-postkit-appcs-prod-ae` | Non-secret settings, including branding CI keys, + **Key Vault references** for secret values. |
| **CI/CD** | GitHub Actions **OIDC** → Azure | Workflows log in with federated creds, then at job runtime: `az appconfig kv show` / `az keyvault secret show`. Mask secret values; never print them. |

**GitHub Actions — allowed identifiers only (repository Variables, not Secrets):**

| Variable | Purpose |
| --- | --- |
| `AZURE_CLIENT_ID` | OIDC app registration application (client) ID |
| `AZURE_TENANT_ID` | Entra tenant ID |
| `AZURE_SUBSCRIPTION_ID` | Azure subscription ID |

**Do not** store connection strings, passwords, deploy tokens, or
`AZURE_CREDENTIALS` in GitHub Secrets.

### Human gates still open

- [ ] OIDC app registration + federated credentials for this repo
- [ ] GitHub Variables `AZURE_CLIENT_ID` / `AZURE_TENANT_ID` / `AZURE_SUBSCRIPTION_ID`
- [ ] Copy required secrets into Key Vault `ssd-global-kv-prod-ae` (names only in git)
- [ ] Provision Function App / plan / storage / App Configuration when the API epic lands
- [ ] Grant the GitHub OIDC app App Configuration Data Owner (bicep param `githubOidcPrincipalId`)
- [ ] Grant the GitHub OIDC app App Configuration Reader for management-plane store reads
- [ ] Set branding keys `app:email:validation:*` in App Configuration (seeded on first Function deploy)

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
