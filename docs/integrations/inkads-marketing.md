# InkAds marketing site — PostKit contact integration

Consumer: [`singleton-sd/poc-inkads-marketing`](https://github.com/singleton-sd/poc-inkads-marketing)

ClickUp: [POC-259](https://app.clickup.com/t/86d42mwdr)

## Public API base URL

InkAds Astro builds set `PUBLIC_POSTKIT_API_BASE_URL` to the shared PostKit
Function App:

```text
https://ssd-postkit-api-prod-ae.azurewebsites.net
```

The contact form posts JSON to `{PUBLIC_POSTKIT_API_BASE_URL}/contact` with an
`Origin` header matching the page host. PostKit applies CORS, per-IP rate
limits, and routes the message to the InkAds inbox using the host profile below.

Health check (no auth):

```bash
curl -fsS "https://ssd-postkit-api-prod-ae.azurewebsites.net/api/health"
```

## InkAds host profile (App Configuration)

Seeded in [`infra/appconfig-seed.json`](../../infra/appconfig-seed.json):

| Host | From | Inbox |
| --- | --- | --- |
| `inkads.poc.singletonsd.com` | `noreply@mail.inkads.poc.singletonsd.com` | `inkads-support@singletonsd.com` |

`app:email:origins` includes `*.poc.singletonsd.com`, so production and
`inkads.poc.singletonsd.com/pr-preview/pr-*` previews share the same allowed
origin host.

## Request shape

`POST /contact` body (browser → PostKit):

```json
{
  "name": "Jane Example",
  "email": "jane@venue.example",
  "subject": "partnership",
  "message": "Venue / company: Example Pub\n\nMessage text…"
}
```

`subject` must be one of: `general`, `sales`, `support`, `partnership`.

InkAds maps the contact form role select to these values (venue →
`partnership`, advertiser → `sales`, other → `general`).

## PR preview behaviour

PR previews are served on `inkads.poc.singletonsd.com` (subpath previews), not
raw `azurestaticapps.net` hosts. Contact submissions from previews therefore use
the production email provider and the InkAds inbox, subject to PostKit rate
limits (`app:email:rateLimitPerMin`).

To capture instead of send on localhost dev, use `http://localhost:4321` — PostKit
returns success via `DevelopmentEmailProvider` without outbound email.

Optional operator override: `EMAIL_ALLOW_PREVIEW_SEND=true` on the Function App
also allows real sends from `azurestaticapps.net` and localhost (see
[`apps/api/src/contact.ts`](../../apps/api/src/contact.ts)).

## Operator verification

After deploying App Configuration changes:

1. `curl -fsS https://ssd-postkit-api-prod-ae.azurewebsites.net/api/health`
2. From an allowed origin, smoke `POST /contact` with a valid body and confirm
   delivery to `inkads-support@singletonsd.com` (or dev capture on localhost).

`/contact` sends plain-text email directly — it does **not** use the
`marketing.contact-us` template or `POST /emails/send`. Template publishing is
only required for authenticated `SendRequest` flows.

## Related docs

- [`docs/guides/public-forms.md`](../guides/public-forms.md)
- [`docs/email-forward-email.md`](../email-forward-email.md)
- Platform Kit reference: `plattform-kit` `docs/marketing-astro-decap.md`
