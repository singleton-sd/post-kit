# Environments — development, staging, production

Companion to [`tenant-onboarding.md`](./tenant-onboarding.md). This page
explains how the three environments are separated in the implemented system,
and how to develop locally without sending real mail.

`TenantEnvironment` is exactly `'development' | 'staging' | 'production'`
([`packages/post-kit-types/src/tenant.ts`](../../packages/post-kit-types/src/tenant.ts)).
Anything else is rejected by the publisher and cannot appear in a credential
mapping.

## What separates the environments

| Boundary | Mechanism |
| --- | --- |
| Identity | A bearer token maps to exactly one `{ tenantId, environment }` pair in `TENANT_KEY_MAP` |
| Request context | `TenantContext.environment` comes only from that mapping, never from the request body |
| Template storage | Blobs live at `tenants/{tenantId}/{environment}/templates/{key}/...` |
| Sender / provider | `EMAIL_FROM_ADDRESS`, `EMAIL_PROVIDER`, `EMAIL_ALLOW_PRODUCTION_SEND` are per-deployment values |

The environment is a property of the **credential**, not of the call. A
staging token cannot read a production template, because the API builds the
blob path from the resolved context
([`blob-template-store.ts`](../../apps/api/src/templates/blob-template-store.ts)).
That also means a template is only available in an environment you actually
published to: run `post-kit-publish --environment <env>` once per environment.

> Sender address and provider selection are **per deployment**, not per
> environment within one deployment. Running staging and production against
> the same Function App would give them the same sender and the same live-send
> setting. Deploy them separately. Per-tenant configuration is tracked in
> [#35](https://github.com/singleton-sd/post-kit/issues/35).

## Never shared across environments

- **Credentials.** One token per tenant + environment. Reusing a production
  token for staging silently makes staging traffic production traffic.
- **Template artefacts.** Blobs are not promoted or copied between prefixes;
  publish each environment from source.
- **Live-send opt-in.** `EMAIL_ALLOW_PRODUCTION_SEND=true` belongs to
  production only.
- **The Forward Email token.** Key Vault only, never in a `.env` that is
  shared or committed.

Safe to share: template *source* in the consumer repository — that is the
point of the Git-backed lifecycle.

## Local development

1. Copy the example env file and fill in values:

   ```bash
   cp .env.example .env
   ```

   Never commit `.env`, and never put a real token in it.

2. Set the keys the send path reads:

   | Key | Local value |
   | --- | --- |
   | `EMAIL_PROVIDER` | `development` |
   | `EMAIL_ALLOW_PRODUCTION_SEND` | leave empty |
   | `EMAIL_FROM_ADDRESS` | `noreply@mail.example.com` |
   | `EMAIL_FROM_NAME` | any display name |
   | `TENANT_KEY_MAP` | JSON map with a locally generated token → `{ "tenantId": "acme", "environment": "development" }` |
   | `TEMPLATE_STORAGE_ACCOUNT` | storage account holding your `development` blobs |
   | `TEMPLATE_STORAGE_CONTAINER` | `templates` (the default when unset) |

   `AZURE_APPCONFIGURATION_ENDPOINT` unset means App Configuration loading is
   a no-op, so your local values are the whole configuration
   ([`app-configuration.ts`](../../apps/api/src/config/app-configuration.ts)).
   When it *is* set, explicit process env still wins.

3. Run the API:

   ```bash
   pnpm --filter @singleton-sd/post-kit-api start   # func start
   ```

   This needs the Azure Functions Core Tools (`func`) installed.

Template loading still reads real Blob Storage — there is no local template
store or emulator wiring today. Point `TEMPLATE_STORAGE_ACCOUNT` at an account
you can read with `az login`, and publish to the `development` prefix.

## Verifying locally without real delivery

The development provider is the default and is a **sink**: it validates
headers, keeps the message in memory, and logs metadata only — never the body
([`development-email.provider.ts`](../../packages/post-kit-email/src/providers/development-email.provider.ts)).

- A successful send returns `200` with `{ "id": "<correlation-id>", "status":
  "sent" }`. "Sent" means *accepted by the sink*, not delivered.
- Look for a log line `{"msg":"email.send.development",...}` containing the
  correlation id, recipient domain, and subject length.
- The returned provider message id is prefixed `dev-`.

Two guards make accidental live delivery unlikely:

- `EMAIL_PROVIDER=forward-email` **without** `EMAIL_ALLOW_PRODUCTION_SEND=true`
  downgrades to the sink and logs `email.provider.downgraded`.
- `NODE_ENV=production` alone does not enable live sending; the opt-in is
  still required
  ([`create-email-provider.ts`](../../packages/post-kit-email/src/providers/create-email-provider.ts)).

If you expected real mail and got none, check for
`email.provider.downgraded` before suspecting the provider.

## Promoting a change

There is no promotion tooling. The manual sequence is:

1. Merge the template source change in the consumer repository.
2. Run `post-kit-publish` against `staging`, send a test, confirm the render.
3. Run the same command against `production`.
4. Send a production test using the production credential.

Blob-level rollback is likewise manual: republish the previous commit's source
with `--commit <previous-sha>`.
