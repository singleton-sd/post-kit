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
2. Require a pull request before merging; **require status checks** (`Lint / test / build`) to pass.
3. Do not require approving reviews (blocks the same human/AI identity that authored the PR).
4. Block force pushes and deletions; disallow direct pushes to `main`.
5. **Human merge only** — agents never merge or review other agents' work.
   Connected review bots leave PR comments; the human validates the test plan
   and merges.

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

### Secrets + configuration (locked)

| Layer | Store | Rule |
| --- | --- | --- |
| **Secrets** | Azure Key Vault `ssd-global-kv-prod-ae` | Tokens, connection strings. Never in git or GitHub Actions secrets. |
| **CI/CD** | GitHub Actions **OIDC** → Azure | Workflows log in with federated creds, then at job runtime: `SECRET_VALUE=$(az keyvault secret show --name <name> --vault-name ssd-global-kv-prod-ae --query value -o tsv)`, immediately `echo "::add-mask::$SECRET_VALUE"`, never print the raw value. |

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
- [ ] Provision Function App / plan / storage when the API epic lands

## 6. npmjs (public packages)

Publishable workspace packages use the `@singleton-sd/post-kit-*` scope and
`"private": false`. The workspace root stays `"private": true` (the monorepo
is not published).

- [ ] npmjs org access for `@singleton-sd`
- [ ] Trusted publishing / OIDC for GitHub Actions when the first package ships

Do not publish from this bootstrap PR — there are no packages yet.
