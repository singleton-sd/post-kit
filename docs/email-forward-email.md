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
| Branding validator | `pnpm validate:email-domain-branding` + scheduled CI |

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
| `EMAIL_VALIDATION_DOMAIN` | Sending domain for branding CI / CLI (public DNS) |
| `EMAIL_VALIDATION_DKIM_SELECTOR` | DKIM selector (default `fe`) |
| `EMAIL_VALIDATION_DMARC_POLICY` | `quarantine` or `reject` (default `quarantine`) |
| `EMAIL_VALIDATION_BIMI_SELECTOR` | BIMI selector (default `default`) |
| `EMAIL_VALIDATION_BIMI_LOGO_URL` | Optional expected BIMI `l=` HTTPS URL |
| `EMAIL_VALIDATION_REQUIRE_BIMI_SVG` | Default `true`; `false` downgrades SVG issues to warnings |

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

## Automated domain branding validation

The reusable validator fails fast when SPF, DKIM, DMARC, BIMI, or BIMI
logo/SVG setup is incomplete for a sending domain. It lives in
`packages/post-kit-email` (`email-domain-branding-validator.ts`). Do not
treat it as a mailbox-rendering check.

```bash
pnpm validate:email-domain-branding -- --domain mail.plattform-kit.poc.singletonsd.com --dkimSelector fe --expectedDmarcPolicy quarantine --bimiSelector default --expectedBimiLogoUrl https://plattform-kit.poc.singletonsd.com/brand/bimi-logo.svg
```

Checks:

- SPF TXT exists on `--domain` and is syntactically recognizable (`v=spf1 …`).
- DKIM TXT exists on `<selector>._domainkey.<domain>` and includes `v=DKIM1`.
- DMARC TXT exists on `_dmarc.<domain>` and matches `--expectedDmarcPolicy`.
- BIMI TXT exists on `<selector>._bimi.<domain>` and includes `v=BIMI1; l=…`.
- BIMI logo URL resolves over HTTPS with a successful HTTP status.
- BIMI SVG has key structural requirements (`<svg>`, `baseProfile="tiny-ps"`,
  `version="1.2"`, no `<script>`, no external HTTP(S) refs).

Configuration can be supplied by CLI flags or env vars (`EMAIL_VALIDATION_*`
in the table above).

### When CI runs vs when operators run it

| Who | When | Command / workflow |
| --- | --- | --- |
| **CI** | Daily 06:00 UTC, `workflow_dispatch`, and pushes to `main` that touch `packages/post-kit-email/**` | `.github/workflows/validate-email-domain-branding.yml` |
| **Operators** | After `pnpm email:provision`, after DNS edits, or when CI is red | `pnpm validate:email-domain-branding` locally (flags or env) |

CI reads **Azure App Configuration** `ssd-postkit-appcs-prod-ae` over OIDC
(not GitHub Variables). Keys are public DNS names / public HTTPS URLs:

| Env | App Config key | Required |
| --- | --- | --- |
| `EMAIL_VALIDATION_DOMAIN` | `app:email:validation:domain` | Yes. If unset (or Azure repository Variables / the store are missing), the job skips. Invalid OIDC federation fails the workflow. |
| `EMAIL_VALIDATION_DKIM_SELECTOR` | `app:email:validation:dkimSelector` | No (CLI default `fe`) |
| `EMAIL_VALIDATION_DMARC_POLICY` | `app:email:validation:dmarcPolicy` | No (CLI default `quarantine`) |
| `EMAIL_VALIDATION_BIMI_SELECTOR` | `app:email:validation:bimiSelector` | No (CLI default `default`) |
| `EMAIL_VALIDATION_BIMI_LOGO_URL` | `app:email:validation:bimiLogoUrl` | No (when set, `l=` must match exactly) |
| `EMAIL_VALIDATION_REQUIRE_BIMI_SVG` | `app:email:validation:requireBimiSvg` | No (CLI default `true`) |

A non-zero validator exit fails the workflow. The job retries a few times
with backoff so short DNS propagation windows do not flake; remaining
failures need a DNS/config fix and a re-run (`workflow_dispatch` or the next
schedule).

Pull requests do **not** run live DNS validation. Unit tests in
`email-domain-branding-validator.spec.ts` cover pass/fail cases with mocked
DNS and fetch. Regular `ci.yml` still runs those tests on every PR.

Suggested operator sequence:

1. Provision DNS (`pnpm email:provision -- --dry-run`, then without dry-run).
2. Wait for TTL / Forward Email verify-records.
3. Run `pnpm validate:email-domain-branding` (or dispatch the workflow).
4. Treat non-zero exit as a gate failure; fix DNS/config and rerun.

Known limitations:

- DNS checks depend on external resolvers and can fail transiently during
  propagation. CI retries; operators should wait and rerun rather than
  treating a single failure as permanent.
- Mailbox-provider rendering (logo display, VMC/CMC, Gmail trust scoring)
  cannot be guaranteed by static DNS/SVG checks. That remains Human &
  Operations (#11, #12).
- The SVG validator enforces practical structural requirements only; it does
  not replace provider-side BIMI compliance decisions.

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
