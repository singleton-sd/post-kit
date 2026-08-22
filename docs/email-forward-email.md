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
| Runtime Function App | Later epic (`apps/api`); this package is the library only |

## Configuration

| Env | Notes |
| --- | --- |
| `FORWARD_EMAIL_TOKEN` | Required for live send / provision. KV secret `forwardemail-api-key` |
| `FORWARD_EMAIL_BASE_URL` | Default `https://api.forwardemail.net` |
| `EMAIL_PROVIDER` | `development` (safe default) or `forward-email` |
| `EMAIL_ALLOW_PRODUCTION_SEND` | Must be `true` with `EMAIL_PROVIDER=forward-email` |
| `EMAIL_FROM_ADDRESS` / `EMAIL_FROM_NAME` | Default sender |
| `CONTACT_INBOX_ADDRESS` | Contact form destination |
| `CONTACT_EMAIL_PROFILES_BY_HOST` | Optional JSON map of host → sender/inbox |

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
`--force-dmarc`, `--hosted-zone-id`.

Dry-run prints the planned Forward Email + Route53 UPSERT batch and does not
mutate. Verify-records / verify-smtp retry a few times; still-pending DNS
exits 0 with a clear message.

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
