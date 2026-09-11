# Onboarding a marketing / contact consumer

Checklist for adding a new public marketing site (or similar) that posts to
PostKit `POST /contact`. Agents: also follow the
`postkit-contact-consumer` skill from
[`singleton-sd/ai-plattform-skills`](https://github.com/singleton-sd/ai-plattform-skills)
(installed via `pnpm sync:skills`).

Do **not** treat App Config `app:email:origins` alone as sufficient — Linux
Consumption handles `OPTIONS` at the **platform**. Browser preflight needs
Function App CORS **exact** origins **and** the App Config hostname allowlist.

## Dual allowlists (required)

| Surface | What to set | Notes |
| --- | --- | --- |
| **Platform CORS** | Exact origin URLs on the Function App (`siteConfig.cors.allowedOrigins` in [`infra/function-app.bicep`](../../infra/function-app.bicep)) | e.g. `https://example.poc.singletonsd.com`, `http://localhost:4321`. No `*.poc…` globs. `supportCredentials: false`. Redeploy or `az functionapp cors add` so live matches bicep. |
| **App Config ORIGINS** | `app:email:origins` (seeded in [`infra/appconfig-seed.json`](../../infra/appconfig-seed.json)) | Hostname allowlist / globs for reflecting `Access-Control-Allow-Origin` and resolving host profiles (e.g. `*.poc.singletonsd.com,localhost:4321`). |

Keep both in sync when adding a consumer.

## Checklist

1. **Origins (App Config)** — Extend `app:email:origins` (and the seed JSON) with the consumer hostname or a safe glob. Apply to store `ssd-postkit-appcs-prod-ae`.
2. **Host profile** — Add an entry under `app:email:profilesByHost` for the production host:
   - `fromAddress` / `fromName` / `contactInboxAddress`
   - Prefer a dedicated sending subdomain (`noreply@mail.<consumer>…`) when branding requires it.
3. **Platform CORS** — Add the exact `https://…` (and local `http://localhost:…` if needed) origins to `infra/function-app.bicep` `siteConfig.cors.allowedOrigins`. Apply live if bicep is not redeployed yet.
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
