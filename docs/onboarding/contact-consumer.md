# Onboarding a marketing / contact consumer

Checklist for adding a new public marketing site (or similar) that posts to
PostKit `POST /contact`. Agents: also follow the
`postkit-contact-consumer` skill from
[`singleton-sd/ai-plattform-skills`](https://github.com/singleton-sd/ai-plattform-skills)
(installed via `pnpm sync:skills`).

**Source of truth for allowed hosts is App Configuration.** Platform CORS on
the Function App is **derived** from that config by
[`scripts/sync-function-cors-from-appconfig.sh`](../../scripts/sync-function-cors-from-appconfig.sh)
(`pnpm cors:sync`, also run by Deploy API). Linux Consumption still needs
platform CORS for browser `OPTIONS` — you do not edit a second hardcoded list
in bicep.

## How allowlists work

| Surface | What to set | Notes |
| --- | --- | --- |
| **App Config ORIGINS** | `app:email:origins` (+ seed) | Hostname allowlist / globs for app-layer `contactCorsHeaders` and trusted host resolution (e.g. `*.poc.singletonsd.com,localhost:4321`). |
| **App Config host profiles** | `app:email:profilesByHost` (+ seed) | Map of production host → from/inbox. **Every profile host is also pushed as an exact `https://…` platform CORS origin.** |
| **Platform CORS** | Synced automatically | Exact origin URLs = exact (non-glob) ORIGINS entries + every `profilesByHost` key. `localhost*` → `http://…`; other hosts → `https://…`. Globs cannot be expressed on the platform. |

After editing App Config (or the seed + portal), run `pnpm cors:sync` (or wait
for Deploy API) so the Function App preflight list matches.

## Checklist

1. **Origins (App Config)** — Extend `app:email:origins` (and the seed JSON) with the consumer hostname or a safe glob. Apply to store `ssd-postkit-appcs-prod-ae`.
2. **Host profile** — Add an entry under `app:email:profilesByHost` for the production host:
   - `fromAddress` / `fromName` / `contactInboxAddress`
   - Prefer a dedicated sending subdomain (`noreply@mail.<consumer>…`) when branding requires it.
   - This host is what platform CORS will allow as `https://<host>`.
3. **Sync platform CORS** — `pnpm cors:sync` (or Deploy API). Confirm with `az functionapp cors show`.
4. **Sending domain (optional but required for new `fromAddress` domains)** — If the profile uses a new mail subdomain, add it to [`packages/post-kit-email/config/email-domains.json`](../../packages/post-kit-email/config/email-domains.json) and run `pnpm email:provision -- --domain <mail-domain>` (see [`docs/email-forward-email.md`](../email-forward-email.md)). Forward Email returns **400 Domain does not exist** until the domain exists on the account — that surfaces as HTTP **500** on `/contact` with `We could not send your message`.
5. **Public API base URL** — Consumers resolve `app:api:publicBaseUrl` from App Configuration at build time (see [`docs/integrations/inkads-marketing.md`](../integrations/inkads-marketing.md)). Do not invent a second source of truth.
6. **Preview header** — Same-host PR previews must send `X-PostKit-Contact-Preview: true` so PostKit uses the development sink instead of live delivery. See contact preview behaviour in the InkAds integration doc.
7. **Smoke tests**
   - `OPTIONS /contact` with `Origin: https://<consumer-host>` → `Access-Control-Allow-Origin` reflected (platform + app).
   - `POST /contact` with a valid body and that Origin → **202** (or intentional **4xx**), never unexplained **500**.
   - `GET /health` on the public API base URL.

## Related docs

- [`docs/integrations/inkads-marketing.md`](../integrations/inkads-marketing.md) — reference consumer
- [`docs/guides/public-forms.md`](../guides/public-forms.md) — trusted-server pattern for public forms
- [`docs/email-forward-email.md`](../email-forward-email.md) — Forward Email + DNS provision
- [`docs/onboarding/tenant-onboarding.md`](./tenant-onboarding.md) — authenticated tenant / template send (not this checklist)
- [`docs/operations/learnings-contact-cors-custom-domain.md`](../operations/learnings-contact-cors-custom-domain.md) — why platform CORS exists
