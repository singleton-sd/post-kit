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

Companion pages:

- [`request-lifecycle.md`](./request-lifecycle.md) — what happens inside a
  single `POST /emails/send` call.
- [`template-lifecycle.md`](./template-lifecycle.md) — how a template gets
  from a consumer repository into Blob Storage.
- [`multi-tenant-security.md`](./multi-tenant-security.md) — tenant
  resolution, environment separation, and the credential boundary.

## System shape

```text
Trusted consumer (server-side only)
        |
        |  @singleton-sd/post-kit-client
        |  POST {endpoint}/emails/send
        |  Authorization: Bearer <token>
        v
PostKit Functions API — apps/api (Azure Functions, anonymous authLevel)
        |
        +--> ensureAppConfiguration()  App Configuration + Key Vault refs -> process.env
        |
        +--> TenantResolver (ApiKeyTenantResolver)
        |        token -> { tenantId, environment }   via TENANT_KEY_MAP
        |
        +--> TemplateStore (BlobTemplateStore, Azure Blob Storage)
        |        tenants/{tenantId}/{environment}/templates/{templateKey}/
        |          template.html + metadata.json
        |
        +--> branding + request variables merge, required-variable check
        |
        +--> Handlebars.compile(subject) / Handlebars.compile(templateHtml)
        |
        v
@singleton-sd/post-kit-email  ->  EmailProvider
        |                            development (in-memory sink)
        |                            forward-email (live send)
        v
Forward Email  ->  per-tenant mail domains
```

Every response — success or failure — carries `X-Correlation-Id`, and every
error body carries `correlationId` plus a stable `PostKitErrorCode`.

## Package ownership

| Workspace                  | npm name                            | Role                                                                                                                                      | Must not                                                                                                              |
| -------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `apps/api`                 | private (`@singleton-sd/post-kit-api`, not published) | HTTP surface on Azure Functions: `POST /emails/send`, `POST /contact`, `GET /health`. Owns tenant resolution, template loading, rendering, and telemetry. | Be imported by packages; accept `tenantId` from a request body; read template *source* files (it loads compiled artifacts only). |
| `packages/post-kit-types`  | `@singleton-sd/post-kit-types`      | Shared contracts only: `SendRequest`/`SendResponse`, `PostKitErrorCode`, `PostKitErrorResponse`, `TenantContext`, `TenantEnvironment`, `TenantBranding`, template source/manifest types, `TEMPLATE_SCHEMA_VERSION`. | Contain runtime code — it has zero runtime dependencies and exports only types, type aliases, and one enum plus one const. |
| `packages/post-kit-client` | `@singleton-sd/post-kit-client`     | Thin typed `PostKitClient` for trusted server callers: builds `POST {endpoint}/emails/send` with a Bearer token, maps HTTP and network failures to `PostKitRequestError`, default 30s timeout. | Ship into browser bundles holding a long-lived API key; re-implement template logic.                                  |
| `packages/post-kit-compiler`| `@singleton-sd/post-kit-compiler`   | Compile a template source directory (`template.json`, `metadata.json`, `preview.json`) into a `CompiledTemplate`: metadata validation, preview-variable coverage, EmailBuilder.js HTML render, Handlebars validation render, SHA-256 content hash. | Talk to Azure or the network; substitute real variable values into the stored HTML (placeholders are preserved for send time). |
| `packages/post-kit-publisher`| `@singleton-sd/post-kit-publisher` | Compile a templates directory and upload artifacts to Blob Storage under the canonical tenant path. Exposes the `post-kit-publish` CLI. Fail-fast: if any template fails to compile, nothing is uploaded. | Accept unvalidated tenant/environment/template/storage-account values — all four go through `path-safety` assertions.  |
| `packages/post-kit-email`  | `@singleton-sd/post-kit-email`      | Provider abstraction and delivery: `EmailProvider`, `createEmailProvider`, `DevelopmentEmailProvider`, `ForwardEmailProvider`, header sanitisation, contact-email helpers, and Forward Email domain provisioning (`post-kit-email-provision`). | Know about tenants, templates, or HTTP request shapes.                                                                |

Packages must not reach into app internals. Public package APIs are explicit
and minimal — for example `post-kit-publisher` only exports `.`, so its
test-only client seam is unreachable from the published surface.

## Not yet implemented

State these plainly rather than assuming them:

- **`@singleton-sd/post-kit-editor`** — the EmailBuilder.js admin editor
  package does not exist in this repository. It is referenced only as a
  future consumer in `post-kit-types` doc comments. Tracked by
  [#5](https://github.com/singleton-sd/post-kit/issues/5).
- **npm publication** — `packages/*` are marked `"private": false`, but
  `.github/workflows/release.yml` only bumps versions, commits, tags, and
  creates GitHub releases. Nothing runs `npm publish`, so no
  `@singleton-sd/post-kit-*` package is installable from the public registry
  yet. Tracked by
  [#4](https://github.com/singleton-sd/post-kit/issues/4).
- **Additional delivery providers, per-tenant send rate limiting, recipient
  allowlisting, and signed webhooks** — not implemented; see
  [`multi-tenant-security.md`](./multi-tenant-security.md) and
  [#6](https://github.com/singleton-sd/post-kit/issues/6).
- **Tenant branding storage** — the send handler merges a `TenantBranding`
  object into template variables, but the default `resolveBranding`
  implementation returns `{}`. There is no branding store yet.

## Consumers

Consumers call PostKit from **trusted server-side** code. Browser code must
never contain long-lived PostKit credentials — a public form should POST to
the consumer's own server endpoint, which then calls PostKit with
`PostKitClient`.

No database is required. Compiled template content lives in Azure Blob
Storage outside the API deployment; template source is Git-backed in consumer
repositories and published by CI.

## Deployment

| Component         | Host                                     | Notes                                                          |
| ----------------- | ---------------------------------------- | -------------------------------------------------------------- |
| API               | Azure Function App `ssd-postkit-api-prod-ae` | Plan `ssd-postkit-plan-prod-ae` (Y1 Consumption)            |
| Storage           | `ssdpostkitstprodae`                     | Function App storage                                           |
| Template storage  | `TEMPLATE_STORAGE_ACCOUNT` / `TEMPLATE_STORAGE_CONTAINER` (default `templates`) | Read with `DefaultAzureCredential`         |
| Send idempotency  | `IDEMPOTENCY_STORAGE_ACCOUNT` (falls back to template account) / container `idempotency` | Blob ledger; see [`send-idempotency.md`](./send-idempotency.md) |
| App configuration | `ssd-postkit-appcs-prod-ae`              | Free SKU; non-secret settings + Key Vault references           |
| Secrets           | Key Vault `ssd-global-kv-prod-ae`        | Resource group `rg-ssd-global`; IDs in [`SETUP.md`](../../SETUP.md) |
| Packages          | npmjs public `@singleton-sd/post-kit-*`  | Not published yet — see **Not yet implemented**                |

CI is `Lint / test / build` on every PR. Live email-domain branding
validation is a separate scheduled workflow (not required on PRs); see
[`docs/email-forward-email.md`](../email-forward-email.md). There are no PR
preview environments in v1. OIDC → Key Vault is the secrets path; GitHub
Secrets are forbidden. IDs and human gates: [`SETUP.md`](../../SETUP.md),
pipelines: [`docs/pr-pipelines.md`](../pr-pipelines.md).
