# Forward Email — outbound email + DNS provisioning

PostKit sends transactional and contact email through a provider-independent
**`EmailProvider`** in `@singleton-sd/post-kit-email` (`packages/post-kit-email`).
The default production adapter is
**[Forward Email](https://forwardemail.net/en/email-api)**. Local and preview
runtimes default to a **development** provider that captures sends without
calling the network.

**No secrets belong in git or PR bodies.**

## Architecture

```text
Trusted consumer / contact form
        │
        ▼
 @singleton-sd/post-kit-email
        │
        ├─ EmailProvider
        │     ├─ DevelopmentEmailProvider   ← default locally
        │     └─ ForwardEmailProvider       ← production when opted in
        │
        └─ ForwardEmailManagementClient     ← deploy-time CLI only
              └─ pnpm email:provision       ← Forward Email + Route53
```

| Concern | Owner |
| --- | --- |
| Runtime send (`POST /v1/emails`) | `ForwardEmailProvider` |
| Domain / alias / verify | `ForwardEmailManagementClient` + `pnpm email:provision` |
| DNS (MX / SPF / DKIM / DMARC / Return-Path) | AWS Route53; credentials from **pc-provision**, not this repo |
| Secret storage | Azure Key Vault `ssd-global-kv-prod-ae` name **`forwardemail-api-key`** |
| App configuration | Azure App Configuration `ssd-postkit-appcs-prod-ae` (Free) |
| Runtime Function App | `apps/api` on `ssd-postkit-api-prod-ae`; loads env from App Config |

## Configuration

Runtime env is filled from App Configuration (`AZURE_APPCONFIGURATION_ENDPOINT`).
Explicit process env always wins (local overrides / tests).

| Env | App Config key | Notes |
| --- | --- | --- |
| `FORWARD_EMAIL_TOKEN` | `secret:forwardemail-api-key` | KV reference, never stored as a value |
| `FORWARD_EMAIL_BASE_URL` | `app:email:forwardEmailBaseUrl` | Default `https://api.forwardemail.net` |
| `EMAIL_PROVIDER` | `app:email:provider` | `development` locally; `forward-email` in prod |
| `EMAIL_ALLOW_PRODUCTION_SEND` | `app:email:allowProductionSend` | Must be `true` with Forward Email |
| `EMAIL_FROM_ADDRESS` / `EMAIL_FROM_NAME` | `app:email:fromAddress` / `fromName` | Default sender |
| `CONTACT_INBOX_ADDRESS` | `app:email:contactInboxAddress` | Contact form destination |
| `CONTACT_EMAIL_PROFILES_BY_HOST` | `app:email:profilesByHost` | JSON map of host → sender/inbox |
| `ORIGINS` | `app:email:origins` | Allowlisted Origin hosts |
| `EMAIL_VALIDATION_*` | `app:email:validation:*` | Branding CI (see branding workflow) |

First-run values are in `infra/appconfig-seed.json`. After that, edit the store
in Azure (seed will not overwrite existing keys). Onboard a new PoC host by
updating `app:email:profilesByHost` in the store, not Function App settings.

AWS credentials for DNS are **not** stored here. Load them from pc-provision
Key Vault `ssd-devtools-kv-prod-ae` (`aws-access-key-id` /
`aws-secret-access-key`) and `route53.zones.map` for zone ids. The CLI uses
the `aws` executable on PATH.

## Provision CLI

Declarative config: `packages/post-kit-email/config/email-domains.json`.

```bash
pnpm email:provision -- --dry-run
pnpm email:provision -- --domain mail.plattform-kit.poc.singletonsd.com
pnpm --filter @singleton-sd/post-kit-email provision -- --skip-dns --skip-verify
```

Flags: `--config`, `--domain`, `--dry-run`, `--skip-dns`, `--skip-verify`,
`--force-dmarc`, `--hosted-zone-id`. Flag values that are missing or start
with `--` are rejected.

Dry-run does not mutate. If the Forward Email domain already exists, dry-run
prints the planned alias work and the Route53 UPSERT batch. If the domain is
missing, dry-run prints the domain-creation intent and skips DNS/alias
planning (those need the API domain payload). Verify-records / verify-smtp
retry a few times; still-pending DNS exits 0 with a clear message.

Do not log `FORWARD_EMAIL_TOKEN` or Authorization headers.

## Preview safety

| Environment | Provider |
| --- | --- |
| Local / agent worktrees | `EMAIL_PROVIDER=development` |
| Production Function | `forward-email` **and** `EMAIL_ALLOW_PRODUCTION_SEND=true` |

## Mail topology

Marketing hostnames that are CNAMEs cannot carry MX/TXT (RFC 1034). Mail
uses `mail.<poc>.poc.singletonsd.com`. If the apex already has a CNAME, the
provisioner skips apex MX/TXT and still applies child DKIM / Return-Path /
DMARC.

## Agent skills

Do not copy a Forward Email `SKILL.md` into this repo. Platform skills live
in [`singleton-sd/ai-plattform-skills`](https://github.com/singleton-sd/ai-plattform-skills)
(`pnpm sync:skills`). Operators: `pnpm email:provision -- --dry-run` first.

## Related

- Package README: [`packages/post-kit-email/README.md`](../packages/post-kit-email/README.md)
- Upstream API: https://forwardemail.net/en/email-api
