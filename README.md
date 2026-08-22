# PostKit

Multi-tenant transactional email platform. PostKit hosts an Azure Functions API
and reusable public npm packages consumed by trusted server-side applications
(backends, marketing sites, admin apps, server actions, background jobs).

## Engineering source of truth

Engineering work (features, bugs, infra, tech debt) is tracked as **GitHub
Issues** in this repository — see
[`docs/github-source-of-truth.md`](./docs/github-source-of-truth.md) for the
full policy. Technical documentation lives under
[`docs/`](./docs/README.md) (start at
[`docs/architecture/overview.md`](./docs/architecture/overview.md)).

ClickUp remains the system of record for private business/commercial planning
org-wide. This repository has **no** ClickUp engineering integration.

## Stack

| Layer | Choice |
| --- | --- |
| API | Azure Functions (`apps/api`, later epic) |
| Packages | Public npm `@singleton-sd/post-kit-*` |
| Email | `@singleton-sd/post-kit-email` (Forward Email + development provider) |
| Secrets | Azure Key Vault `ssd-global-kv-prod-ae` |
| CI | GitHub Actions — single `CI` workflow (`Lint / test / build`) |
| Release | Path-aware bumps via `scripts/release-changed.mjs` |
| Agents | GitHub Issues → worktree → PR (`Closes #N`); humans merge |

## Quick start

```bash
pnpm install
pnpm sync:skills
pnpm test
pnpm lint
```

Skills come from the
[`singleton-sd/ai-plattform-skills`](https://github.com/singleton-sd/ai-plattform-skills)
marketplace (`task-driven-development`, `backend`, `frontend` for Cursor,
Claude Code, Grok, and Codex). Do not copy `SKILL.md` files into this repo.

See [SETUP.md](./SETUP.md), [AGENTS.md](./AGENTS.md), and
[docs/pr-pipelines.md](./docs/pr-pipelines.md).
