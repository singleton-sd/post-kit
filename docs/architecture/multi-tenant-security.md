# Multi-tenant security model

Where the tenant and environment boundaries actually sit, what enforces them,
and what PostKit does not enforce yet.

Implemented in
[`apps/api/src/tenant/api-key-tenant-resolver.ts`](../../apps/api/src/tenant/api-key-tenant-resolver.ts),
[`apps/api/src/templates/blob-template-store.ts`](../../apps/api/src/templates/blob-template-store.ts),
[`apps/api/src/functions/send.ts`](../../apps/api/src/functions/send.ts), and
[`packages/post-kit-publisher/src/path-safety.ts`](../../packages/post-kit-publisher/src/path-safety.ts).

## Tenant identity comes from the credential

A caller sends:

```text
Authorization: Bearer <token>
```

`ApiKeyTenantResolver` looks the token up in a `TenantKeyMap` and returns a
`TenantContext` of `{ tenantId, environment }`. The map is injected at
construction — in production it is parsed from the `TENANT_KEY_MAP`
environment variable as JSON (an unparseable value yields an empty map, so
every request then fails closed with `403 UNAUTHORIZED`).

Shape, with placeholder values only:

```json
{
  "<token-for-acme-production>": { "tenantId": "acme", "environment": "production" },
  "<token-for-acme-development>": { "tenantId": "acme", "environment": "development" }
}
```

Consequences that follow directly from this design:

- **One credential maps to exactly one tenant *and* one environment.** There
  is no way for a caller to select a tenant or an environment per request. A
  tenant that needs `development` and `production` access needs two tokens.
- **`tenantId` is never accepted from the request body.** `SendRequest` has no
  tenant field, and the handler only ever uses the resolver's output.
- Resolver failures are distinguished: a missing `Authorization` header, a
  non-Bearer scheme, or an empty token give `401 UNAUTHENTICATED`; a
  syntactically fine token that is not in the map gives `403 UNAUTHORIZED`.
- The Bearer scheme is matched case-insensitively (`bearer` is accepted) with
  one or more spaces before the credential.
- Token lookup uses `Object.prototype.hasOwnProperty`, so prototype-chain
  names such as `toString` or `__proto__` cannot be used as valid tokens.
- The token value is never included in an error message or a log entry. Logs
  carry only the declared `LogEntry` fields — `correlationId`, `tenantId`,
  `environment`, `templateKey`, `outcome`, `durationMs`, `providerMessageId`,
  and `errorCode`.

The Azure Functions binding uses `authLevel: 'anonymous'`. That is
deliberate: PostKit performs its own authentication, and no Functions host key
is involved in tenant identity.

## Environment separation is a storage-path boundary

`TenantEnvironment` is `'development' | 'staging' | 'production'`, and the
environment from the credential is interpolated straight into the blob path:

```text
tenants/{tenantId}/{environment}/templates/{templateKey}/…
```

So a development credential physically cannot read a production template
artifact — it resolves a different blob prefix, and a missing blob returns
`404 TEMPLATE_NOT_FOUND`. This is enforcement, not just a naming convention,
because the path is derived from server-side state the caller cannot
influence.

On the publish side, `post-kit-publisher` asserts the environment is one of
the three known values before building any path, so a typo cannot create a
fourth pseudo-environment directory.

The read side does not have that assertion. `parseTenantKeyMap()` in the send
handler casts the parsed `TENANT_KEY_MAP` JSON to `TenantKeyMap` without
validating it, and `BlobTemplateStore.load()` interpolates `tenantId` and
`environment` into the path without re-checking them (only `templateKey` is
re-validated). A malformed map entry — a `tenantId` containing `/` or `..`, or
an `environment` outside the three known values — would therefore produce an
unintended blob prefix. `TENANT_KEY_MAP` is trusted operator configuration, not
caller input, so this is a configuration-integrity concern rather than a
request-level bypass; see **What is not enforced yet**.

Note the scope of the boundary: it isolates **template content**. Provider
credentials, the from-address, and the storage account are process-level
configuration shared by every tenant served by a given Function App
deployment.

## Path safety

Template keys and storage account names are validated before they reach a blob
path. Tenant ID and environment are validated at **publish** time by
`post-kit-publish`; the API-side store does not re-validate them today (see
**What is not enforced yet** and [#59](https://github.com/singleton-sd/post-kit/issues/59)).

| Value           | Rule                                                          | Enforced in                                                   |
| --------------- | ------------------------------------------------------------- | ------------------------------------------------------------- |
| Template key    | `/^[a-zA-Z0-9._-]+$/`, and not the bare dot-segments `.` or `..` | Send handler (`isSafeTemplateKey`), `BlobTemplateStore.load()`, publisher (`assertSafeTemplateKey`) |
| Tenant ID       | Alphanumeric with internal hyphens, no `..`                    | Publisher (`assertSafeTenantId`) at publish time only         |
| Environment     | One of `development`, `staging`, `production`                   | Publisher (`assertSafeEnvironment`) at publish time only; type system elsewhere |
| Storage account | `/^[a-z0-9]{3,24}$/`                                           | Publisher (`assertSafeStorageAccount`)                        |

The template-key check is deliberately duplicated: the handler rejects an
unsafe key as `400 INVALID_TEMPLATE` before any storage call, and the store
re-checks it so the boundary holds even if the store is called from somewhere
else. Because `/` is not in the allowlist, a key cannot escape its tenant and
environment prefix, and because bare `.` and `..` are rejected explicitly,
neither can a dot-segment.

Recipient addresses go through a basic email-shape check in the handler, and
`post-kit-email` sanitises header values and rejects CR/LF in header fields,
so a variable value cannot inject an email header.

## Credential and secret handling

- **Server-side only.** `PostKitClient` is for trusted server code. Browser
  code must never hold a long-lived PostKit token; a public form should POST
  to the consumer's own server route, which then calls PostKit.
- **Secrets live in Key Vault** (`ssd-global-kv-prod-ae`). Non-secret settings
  live in Azure App Configuration or Function App settings. See
  [`SETUP.md`](../../SETUP.md).
- At startup the API calls `ensureAppConfiguration()`, which reads App
  Configuration and resolves Key Vault references into `process.env` using
  `DefaultAzureCredential`. Explicit environment variables always win over
  the store, and a missing `AZURE_APPCONFIGURATION_ENDPOINT` makes the load a
  no-op (local development and unit tests).
- Blob Storage access uses `DefaultAzureCredential` — Managed Identity in
  Azure, `az login` locally. No storage connection string or account key is
  required by the send path.
- CI authenticates to Azure with **OIDC** using repository *Variables* holding
  IDs only. Tokens and `AZURE_CREDENTIALS` in GitHub Secrets are forbidden.
- `TENANT_KEY_MAP` contains live credentials and is therefore a secret. Never
  commit it, and never paste a real token into an issue, PR, or log.
- Logging is allowlisted by construction: the logger emits only the declared
  `LogEntry` fields, and the code comments state the rule — no recipient
  addresses, no variable values, no tokens.
- Caller-supplied `x-correlation-id` values are sanitised to 8–128 characters
  of `[a-zA-Z0-9_-]` before being logged or echoed, so a header cannot inject
  content into a log line.

## What is not enforced yet

State these plainly; do not assume any of them exist.

- **No per-tenant rate limiting on `POST /emails/send`.** The contact endpoint
  (`POST /contact`) has an in-memory per-IP limiter, but the send endpoint has
  none. A leaked tenant token can be used as fast as the provider allows.
- **No recipient allowlisting or domain restriction.** `to` only has to look
  like an email address. Any authenticated tenant can send to any address.
- **No signed webhooks and no delivery-event callbacks.** PostKit returns a
  synchronous `sent` status only; there is no bounce, complaint, or delivery
  notification surface.
- **No token expiry, rotation, or revocation mechanism.** Revocation means
  editing `TENANT_KEY_MAP`. There is no expiry field, no hashing of stored
  tokens, and no per-token audit trail beyond `tenantId` in the logs.
- **No per-tenant scoping of the sender identity.** `EMAIL_FROM_ADDRESS` and
  `EMAIL_FROM_NAME` are process-wide, so all tenants on a deployment share the
  configured from address.
- **No tenant branding store.** The handler merges `TenantBranding` into
  template variables, but the default `resolveBranding` returns `{}`.
- **No idempotency key.** Retrying a send after a timeout may send twice.
- **No validation of `TENANT_KEY_MAP` contents.** The JSON is cast to
  `TenantKeyMap` and its `tenantId` / `environment` values reach the blob path
  unchecked, so an operator typo can silently point a credential at an
  unintended prefix instead of failing loudly. Tracked in
  [#59](https://github.com/singleton-sd/post-kit/issues/59).

Hardening in these areas — additional providers, observability, reliability,
and security controls — is tracked by
[#6](https://github.com/singleton-sd/post-kit/issues/6).

## Public-repository boundary

This repository is public. Everything committed or posted here is permanently
visible. Never place real tenant identifiers, tokens, customer names, or
account/resource identifiers in code, docs, issues, PRs, or Actions logs — use
placeholders such as `acme`. The full policy is in
[`docs/github-source-of-truth.md`](../github-source-of-truth.md) section 7.
