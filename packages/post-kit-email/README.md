# `@singleton-sd/post-kit-email`

Public npm package: provider-agnostic transactional email for PostKit.

- Runtime: `EmailProvider` (`development` | `forward-email`)
- Contact helpers and host-profile map (`CONTACT_EMAIL_PROFILES_BY_HOST`)
- Deploy-time: `ForwardEmailManagementClient` + `pnpm email:provision`
- Branding: `pnpm validate:email-domain-branding` (SPF/DKIM/DMARC/BIMI)

Runtime senders must not import Route53 writers. Provisioning is CLI-only
(`src/bin/provision.ts`).

See [`docs/email-forward-email.md`](../../docs/email-forward-email.md).
