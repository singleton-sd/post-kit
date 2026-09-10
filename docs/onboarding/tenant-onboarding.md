# Tenant onboarding — from nothing configured to first email

This guide takes a new tenant or PoC from an empty configuration to a
delivered (or captured) first email, using **only behaviour that exists in
this repository today**. Where a step is manual or not yet automated, it says
so.

Placeholders used throughout: tenant `acme`, domain `example.com`, template
key `marketing.contact-us`. Never put a real token, customer name, or
resource identifier in this repository.

## Before you start

| You need | Why |
| --- | --- |
| Write access to the consumer repository | Template sources live there |
| Someone who can edit Azure App Configuration / Key Vault | Credentials and sender configuration are operator-owned |
| An Azure identity that can write the templates container | `post-kit-publish` uses `DefaultAzureCredential` |

Read [`docs/architecture/overview.md`](../architecture/overview.md) for the
system shape and [`docs/onboarding/environments.md`](./environments.md) for
how development, staging, and production are kept apart.

## Step 1 — Choose a tenant identifier

**Produces:** the `tenantId` string used in every credential mapping and every
blob path.

The publisher validates the identifier with
`assertSafeTenantId` in
[`packages/post-kit-publisher/src/path-safety.ts`](../../packages/post-kit-publisher/src/path-safety.ts):
it must match `/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/` — alphanumerics and
inner hyphens only, no dots, no underscores, no path separators.

Conventions on top of that rule:

- **Use lowercase.** Blob paths are case-sensitive, and the API builds the
  read path from the credential mapping while the publisher builds the write
  path from `--tenant`. A case mismatch between the two produces a
  `404 TEMPLATE_NOT_FOUND` that looks like a missing template.
- **Treat it as permanent.** The identifier appears in
  `tenants/{tenantId}/{environment}/templates/...`
  (see [`blob-template-store.ts`](../../apps/api/src/templates/blob-template-store.ts)).
  Renaming a tenant means republishing every template under the new prefix and
  reissuing every credential. There is no rename tooling.
- Prefer a short organisational name (`acme`), not a product or campaign name.

## Step 2 — Choose environments

**Produces:** the set of `TenantEnvironment` values you will operate.

`TenantEnvironment` is exactly `'development' | 'staging' | 'production'`
([`packages/post-kit-types/src/tenant.ts`](../../packages/post-kit-types/src/tenant.ts)).
The publisher rejects anything else.

Each environment is an independent slice: its own credential, its own blob
prefix, and therefore its own copy of every published template. Publishing to
`staging` does not make a template visible to a `production` credential.
Details in [`environments.md`](./environments.md).

## Step 3 — Issue and register a consumer credential

**Produces:** one bearer token per tenant + environment (shown once), and one
hashed entry in the `TENANT_KEY_MAP` Key Vault secret (schema v2).

The API authenticates with `Authorization: Bearer <token>`.
[`ApiKeyAuthenticator`](../../apps/api/src/auth/authenticate.ts) hashes the
presented token, matches a stored digest (or dual-reads a legacy plaintext
entry), and returns a `Principal` with `{ tenantId, environment, scopes, id }`.
The token **is** the tenant identity — nothing in the request body can change
it.

### Register with the repo script (preferred)

```bash
# Dry-run (no Azure writes) — prints a sample token once
./scripts/register-tenant-api-key.sh \
  --tenant-id inkads \
  --environment production \
  --dry-run

# Create / merge into Key Vault + wire Function App Key Vault reference
./scripts/register-tenant-api-key.sh \
  --tenant-id inkads \
  --environment production
```

Or: `pnpm tenant:register-key -- --tenant-id inkads --environment production`

The script:

1. Generates a high-entropy token (`tk_live_…` / `tk_stg_…` / `tk_dev_…`)
2. Stores **only** the SHA-256 digest + metadata in Key Vault secret
   `tenant-key-map` on `ssd-postkit-kv-prod-ae` (preserves other hashed keys;
   moves pure legacy maps under `legacyPlaintext` for dual-read)
3. Sets Function App `TENANT_KEY_MAP` to a **Key Vault reference** (not plain
   text, not App Configuration)
4. Prints the new token **once** on stdout — copy it into the consumer’s secret
   store; never commit it. Plaintext is **not** written to Key Vault.

Defaults match the dedicated PostKit subscription / RG / Function App / vault
(`ssd-postkit-kv-prod-ae` — not the legacy shared vault). Override with flags
or `AZURE_*` env vars (`--help` for the list).

**Serialize registrations.** The script read-modify-writes one Key Vault
secret. Do not run it concurrently across operators or hosts; run one
registration at a time.

### Registry shape (schema v2)

```json
{
  "schemaVersion": 2,
  "keys": {
    "ak_<truncated-sha256>": {
      "keyHash": "<sha256-hex>",
      "tenantId": "acme",
      "environment": "production",
      "scopes": [
        "templates:read",
        "templates:validate",
        "templates:preview",
        "email:send"
      ],
      "revokedAt": null,
      "expiresAt": null
    }
  }
}
```

Legacy plaintext maps still authenticate until re-registered. On the next
registration against a pure legacy secret, the script wraps leftover entries
under `legacyPlaintext` and puts new keys only under `keys`. Re-registering an
existing legacy token hashes it and removes that token from `legacyPlaintext`.
See [`multi-tenant-security.md`](../architecture/multi-tenant-security.md) for
cutover steps.

Rules that the code enforces or that you must uphold:

- **One token per tenant + environment.** A token maps to exactly one pair; to
  serve two environments, issue two tokens (run the script twice).
- **Server-side only.** The credential must never reach a browser. Public
  forms post to your own server endpoint, which then calls PostKit. See
  [`packages/post-kit-client/README.md`](../../packages/post-kit-client/README.md).
- **Where it lives:** Key Vault `ssd-postkit-kv-prod-ae` secret `tenant-key-map`,
  referenced from the Function App setting `TENANT_KEY_MAP`. Unlike every other
  runtime key, it is **not** in `APP_CONFIGURATION_ENVIRONMENT_KEYS`
  ([`app-configuration.ts`](../../apps/api/src/config/app-configuration.ts)).
  **Where it never lives:** browser bundles, this repository, committed `.env`
  files, App Configuration values, or GitHub Secrets as a raw token.

Rotation: run the script again to mint a new token, switch the consumer, then
set `revokedAt` on the old hashed record (or delete it) in the KV secret.

Failure modes: a missing or non-`Bearer` header is `401 UNAUTHENTICATED`; a
well-formed token that is unknown, revoked, or expired is `403 UNAUTHORIZED`.
Token values are never logged; success logs include opaque `principalId`.

## Step 4 — Configure sender identity

**Produces:** `EMAIL_FROM_ADDRESS` and `EMAIL_FROM_NAME` for the runtime, plus
a verified sending domain.

`EMAIL_FROM_ADDRESS` is the envelope sender for every send. If it resolves to
an empty string the handler returns `503` with
`PROVIDER_FAILURE` and the message `Email sender is not configured.`
`EMAIL_FROM_NAME` is optional and is used as the display name.

Both keys are present in [`.env.example`](../../.env.example) and are mapped
from App Configuration (`app:email:fromAddress`, `app:email:fromName`).

Provider selection is separate: `EMAIL_PROVIDER` plus
`EMAIL_ALLOW_PRODUCTION_SEND`. Live Forward Email delivery requires **both**
`EMAIL_PROVIDER=forward-email` and `EMAIL_ALLOW_PRODUCTION_SEND=true`;
otherwise the runtime downgrades to the development sink and logs
`email.provider.downgraded`
([`create-email-provider.ts`](../../packages/post-kit-email/src/providers/create-email-provider.ts)).

> Sender identity is currently **global to the Function App**, not per tenant.
> Every tenant on a deployment sends from the same address. Per-tenant sender
> and provider configuration is tracked in
> [#35](https://github.com/singleton-sd/post-kit/issues/35). Until it lands,
> isolate tenants that need distinct senders by deploying separately.

Domain, DNS, DKIM/SPF/DMARC/BIMI, and the provisioning CLI are covered in
[`docs/email-forward-email.md`](../email-forward-email.md) — follow that guide
rather than repeating DNS setup here.

## Step 5 — Configure branding defaults

**Produces:** the variable values that every template for this tenant can rely
on without the caller supplying them.

The send handler merges variables in this precedence order, lowest first
([`send.ts`](../../apps/api/src/functions/send.ts)):

1. `resolveBranding(tenant)` — tenant branding defaults
2. static `branding` injected into the handler (test seam)
3. the request's `variables`

The merge happens **before** required-variable validation, so a branding value
can satisfy a variable declared in `metadata.json`, and a request variable of
the same name overrides branding.

> **Not yet configurable.** The production wiring
> (`createDefaultSendDependencies`) uses `resolveBranding: async () => ({})` —
> it always returns an empty object. There is no branding store, config key, or
> API today. Until [#35](https://github.com/singleton-sd/post-kit/issues/35)
> adds tenant-scoped configuration, **every template variable must be supplied
> in the request's `variables` object**, including logo URLs, brand colours,
> and company names. Plan your `metadata.json` variable list accordingly.

## Step 6 — Place source templates in the consumer repo

**Produces:** one directory per template in the consumer repository.

The publisher treats every subdirectory of the templates root as one template
and requires all three files
([`publish.ts`](../../packages/post-kit-publisher/src/publish.ts)):

```text
consumer-app/
└─ content/
   └─ email-templates/
      └─ marketing.contact-us/
         ├─ template.json    (EmailBuilder.js document)
         ├─ metadata.json    (key, name, subject, variables, schemaVersion)
         └─ preview.json     (sample variable values for preview)
```

A missing file fails the whole run with
`Template directory "<name>" is missing required file <file>`, and nothing is
uploaded.

The **`key` field inside `metadata.json`** — not the directory name — becomes
the blob path segment and is therefore the value callers pass as `template`.
Keep the directory name identical to the key so the repository is readable.
`schemaVersion` must match the version the API expects; the API rejects a
mismatched key or version with `400 INVALID_TEMPLATE`
([`blob-template-store.ts`](../../apps/api/src/templates/blob-template-store.ts)).
Template keys must match `/^[a-zA-Z0-9._-]+$/`; dots are the convention for
namespacing (`marketing.contact-us`, `auth.password-reset`).

Authoring detail (field-by-field schema, Handlebars usage, preview data) is
being written under
[#53](https://github.com/singleton-sd/post-kit/issues/53); until it lands, use
the compiler package as the reference:
[`packages/post-kit-compiler`](../../packages/post-kit-compiler).

## Step 7 — Publish templates

**Produces:** `template.html` and `metadata.json` blobs under the tenant's
environment prefix.

```bash
pnpm exec post-kit-publish \
  --templates ./content/email-templates \
  --tenant acme \
  --environment production \
  --storage-account <storage-account-name> \
  --container templates \
  --commit "$GITHUB_SHA"
```

`--templates`, `--tenant`, `--environment`, `--storage-account`, and
`--container` are all required; `--commit` is optional and is recorded as the
manifest's source commit. Authentication is `DefaultAzureCredential` —
`az login` locally, OIDC-federated managed identity in CI. No connection
strings.

Resulting blob layout:

```text
tenants/acme/production/templates/marketing.contact-us/template.html
tenants/acme/production/templates/marketing.contact-us/metadata.json
```

The run is fail-fast: if any template fails to compile, or two directories
compile to the same key, the CLI exits non-zero and uploads **nothing**.

Run it once per environment you operate. The account and container must match
the API's `TEMPLATE_STORAGE_ACCOUNT` and `TEMPLATE_STORAGE_CONTAINER`
(the container defaults to `templates` when unset).

A CI workflow example lives in
[`packages/post-kit-publisher/README.md`](../../packages/post-kit-publisher/README.md);
the full publishing-pipeline guide is
[#53](https://github.com/singleton-sd/post-kit/issues/53).

## Step 8 — Send a first test email

**Produces:** a `200` response with a correlation id, and a captured or
delivered message.

The route is `POST /emails/send` (the Function App sets an empty route prefix,
so there is no `/api` segment).

```bash
curl -i -X POST "https://<your-postkit-host>/emails/send" \
  -H "Authorization: Bearer $POSTKIT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
        "template": "marketing.contact-us",
        "to": "someone@example.com",
        "variables": { "name": "Ada", "message": "Hello from PostKit" }
      }'
```

Equivalent typed call from trusted server-side code:

```ts
import { PostKitClient } from '@singleton-sd/post-kit-client';

const postKit = new PostKitClient({
  endpoint: process.env.POSTKIT_URL!,
  apiKey: process.env.POSTKIT_API_KEY!,
});

const result = await postKit.send({
  template: 'marketing.contact-us',
  to: 'someone@example.com',
  variables: { name: 'Ada', message: 'Hello from PostKit' },
});
```

Install from npmjs (`pnpm add @singleton-sd/post-kit-client`) or consume from
the monorepo workspace (`workspace:*`) during local development.

Success — HTTP `200`, with the correlation id in both the body and the
`X-Correlation-Id` response header:

```json
{ "id": "<correlation-id>", "status": "sent" }
```

Every response, including errors, carries `X-Correlation-Id`. If you send
`X-Correlation-Id` on the request it is echoed back; quote it when reporting a
problem.

Failure responses share one shape:

```json
{ "error": "<human-readable message>", "code": "<PostKitErrorCode>", "correlationId": "<id>" }
```

If the runtime resolved to the development provider, `status: "sent"` means
**captured, not delivered** — the message is logged as
`email.send.development` and never leaves the process. That is the expected
first-run result locally.

## Step 9 — Diagnose a failure

| Status / code | Most likely cause | Next action |
| --- | --- | --- |
| `401` `UNAUTHENTICATED` | No `Authorization` header, wrong scheme, or empty token | Send `Authorization: Bearer <token>` |
| `403` `UNAUTHORIZED` | Token is well-formed but absent from `TENANT_KEY_MAP` | Check the map entry and that the deployment you are calling has it |
| `404` `TEMPLATE_NOT_FOUND` | No blob at `tenants/{tenantId}/{environment}/templates/{key}` | Republish for **this** environment; check tenant-id casing and the template key |
| `400` `INVALID_TEMPLATE` | Unsafe/empty template key, malformed `metadata.json`, key mismatch, or unsupported `schemaVersion` | Fix the source `metadata.json` and republish |
| `400` `MISSING_VARIABLES` | Template declares variables the request did not supply | Add them to `variables` (branding cannot supply them yet — Step 5) |
| `400` `INVALID_RECIPIENT` | Body is not a JSON object, or `to` is not a valid address | Fix the request body |
| `503` `PROVIDER_FAILURE` — "Email sender is not configured." | `EMAIL_FROM_ADDRESS` is empty | Set the sender (Step 4) |
| `503` `PROVIDER_FAILURE` — provider error | Provider misconfiguration, throttling, or a transient upstream failure | Check provider config and retry; see [`email-forward-email.md`](../email-forward-email.md) |
| `503` `STORAGE_FAILURE` | App Configuration could not be loaded at request time | Check the Function App's `AZURE_APPCONFIGURATION_ENDPOINT` and its managed identity |
| `502` `PROVIDER_FAILURE` | Provider rejected the message | Inspect provider logs with the correlation id |
| `200` but no mail arrives | Runtime downgraded to the development provider | Confirm `EMAIL_PROVIDER=forward-email` **and** `EMAIL_ALLOW_PRODUCTION_SEND=true`; look for `email.provider.downgraded` |

Deeper operational triage is being written under
[#54](https://github.com/singleton-sd/post-kit/issues/54).

## Not yet available

| Topic | Status |
| --- | --- |
| Per-tenant sender, provider, and branding configuration | [#35](https://github.com/singleton-sd/post-kit/issues/35) |
| Onboarding automation (token minting, tenant bootstrap CLI) | None. Every step above that touches configuration is manual. |

`@singleton-sd/post-kit-client` and `@singleton-sd/post-kit-editor` are
published on npmjs. Admin embedding (list/load/save + Send-test BFF) is
demonstrated in [`examples/admin-editor`](../../examples/admin-editor/);
onboarding epic: [#7](https://github.com/singleton-sd/post-kit/issues/7).
