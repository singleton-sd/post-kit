# Architecture overview

PostKit is a reusable, multi-tenant transactional email platform. Trusted
server-side consumers (backends, marketing sites, admin apps, server actions,
background jobs) call PostKit rather than talking to an email vendor
directly.

This page is the narrative entry point. Per
[`docs/github-source-of-truth.md`](../github-source-of-truth.md) section 1,
repository documentation is the authoritative store for this kind of
technical knowledge. For the full list of docs, see
[`docs/README.md`](../README.md).

## Phase 1 system shape

```text
Consumer app (trusted server)
        |
        v
PostKit Functions API (apps/api)     -- later epic
        |
        v
@singleton-sd/post-kit-email         -- later epic
        |
        +--> EmailProvider (development | forward-email)
        |
        v
Forward Email  →  per-tenant mail domains
```

| Piece | Role | Status |
| --- | --- | --- |
| **Functions API** (`apps/api`) | Contact/send HTTP surface on Azure Functions Consumption | Planned — not in this bootstrap |
| **EmailProvider** | Swap development logging vs Forward Email production send | Planned in `post-kit-email` |
| **Forward Email** | Production delivery + per-tenant mail domain provisioning | Planned |
| **Public npm packages** | `@singleton-sd/post-kit-*` consumed by trusted apps | First package: `post-kit-email` |

No database is required for email templates. Runtime template content (later)
is stored outside the API deployment, initially Azure Blob Storage. Templates
are Git-backed in consumer repositories and published by CI.

## Consumers

Consumers call PostKit from **trusted server-side** code. Browser code must
never contain long-lived PostKit credentials.

Packages must not reach into app internals. Shared contracts belong in a
types package when that epic lands. Public package APIs must be explicit and
minimal.

## Later epics

Not in this bootstrap:

- **Templates** — Git-backed EmailBuilder JSON, compiler to HTML, publisher
- **Client** — trusted-consumer SDK (`post-kit-client`)
- **Editor** — EmailBuilder.js wrapper (`post-kit-editor`)

## Deployment (planned)

| Component | Host | Notes |
| --- | --- | --- |
| API | Azure Function App `ssd-postkit-api-prod-ae` | Plan `ssd-postkit-plan-prod-ae` (Y1 Consumption) |
| Storage | `ssdpostkitstprodae` | Function App storage |
| Secrets | Key Vault `ssd-global-kv-prod-ae` | Subscription `01c0bb8b-3770-4765-979a-cb13ae7e3dd2`, RG `rg-ssd-global` |
| Packages | npmjs public `@singleton-sd/post-kit-*` | Root workspace is private and not published |

CI is a single GitHub Actions workflow (`Lint / test / build`). There are no
PR preview environments in v1. OIDC → Key Vault is the secrets path; GitHub
Secrets are forbidden. IDs and human gates: [`SETUP.md`](../../SETUP.md),
pipelines: [`docs/pr-pipelines.md`](../pr-pipelines.md).
