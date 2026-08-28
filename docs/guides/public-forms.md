# Public web forms (Contact Us, waitlist signup)

How to collect a submission from a **public, unauthenticated browser form** and
deliver it through PostKit **without ever placing a PostKit credential in
browser code**.

This is the reference pattern for every public-form integration: marketing-site
"Contact Us", waitlist / whitelist signup, demo requests, newsletter
double-opt-in. They are all the same shape — an anonymous visitor submits data,
and a trusted server component turns that into a templated email.

Worked example: [`examples/marketing-contact-us/`](../../examples/marketing-contact-us/).

## The required topology

```text
   ┌────────────────────────┐
   │ Browser (public form)  │   no credential of any kind lives here
   │ name / email / message │
   └───────────┬────────────┘
               │  1. POST same-origin JSON (or a form action / server action)
               ▼
   ┌──────────────────────────────────────────────────────────┐
   │ YOUR trusted server endpoint                             │
   │  - validates + length-limits input                        │
   │  - spam / abuse mitigation (captcha or equivalent)        │
   │  - rate limits per client IP                              │
   │  - chooses the template key (never from the request)      │
   │  - chooses the recipient  (never from the request)        │
   │  - holds POSTKIT_API_KEY from server-side env / Key Vault │
   └───────────┬──────────────────────────────────────────────┘
               │  2. PostKitClient.send({ template, to, variables })
               ▼
   ┌────────────────────────────────────────────┐
   │ @singleton-sd/post-kit-client              │
   │ Authorization: Bearer <POSTKIT_API_KEY>    │
   └───────────┬────────────────────────────────┘
               │  3. POST {endpoint}/emails/send
               ▼
   ┌────────────────────────────────────────────┐
   │ PostKit API (apps/api)                     │
   │  - resolves tenant from the bearer token   │
   │  - loads the tenant's compiled template    │
   │  - renders subject + HTML                  │
   └───────────┬────────────────────────────────┘
               │  4. EmailProvider.send(...)
               ▼
        ┌───────────────────┐
        │ Email provider    │ → inbox
        └───────────────────┘
```

Steps 2–4 all happen server-side. The browser only ever talks to step 1, which
is **your** endpoint on **your** origin, and it returns nothing but a generic
success or failure.

## Why the browser must never hold the PostKit credential

The PostKit API authenticates with `Authorization: Bearer <token>` and resolves
the token in `TENANT_KEY_MAP`
(`apps/api/src/tenant/api-key-tenant-resolver.ts`). That map takes a token
straight to a `{ tenantId, environment }` pair:

```jsonc
{
  "<token>": { "tenantId": "acme", "environment": "production" },
}
```

There is no second factor, no per-form scope, and no origin check on
`POST /emails/send`. So a leaked token is **full tenant impersonation**: anyone
holding it can send any of that tenant's published templates, to any recipient
address that passes basic email validation, in that tenant's production
environment, with that tenant's `EMAIL_FROM_ADDRESS` and branding. The blast
radius is your sending reputation and your customers' inboxes.

Anything shipped to a browser is public. Minification, a private repo, an
obfuscated variable name, and a same-origin fetch do not make a token secret —
`view-source` and the network tab do not care.

## Anti-patterns

### Do not call `POST /emails/send` from client-side JavaScript

```js
// DO NOT DO THIS
await fetch('https://postkit.example.com/emails/send', {
  method: 'POST',
  headers: { Authorization: `Bearer ${POSTKIT_API_KEY}` },
  body: JSON.stringify({ template: 'marketing.contact-us', to, variables }),
});
```

Why: the key is in the bundle, so it is published. It also hands the caller
control of `template` and `to` — the two fields that decide *what* is sent and
*who* receives it.

### Do not proxy the raw `Authorization` header

```js
// DO NOT DO THIS — a credential-forwarding proxy
app.post('/api/postkit/*', (req, res) =>
  forward(req, { headers: { Authorization: req.headers.authorization } }),
);
```

Why: if the browser supplies the header, the browser has the credential — the
proxy changes nothing. And a pass-through proxy that injects a server-side key
but forwards the client's body is just as bad: it is an open relay for every
template the tenant has published. A trusted endpoint must accept **form
fields**, not a `SendRequest`.

### Do not put the key in a build-time public env var

```text
# DO NOT DO THIS
NEXT_PUBLIC_POSTKIT_API_KEY=...
VITE_POSTKIT_API_KEY=...
PUBLIC_POSTKIT_API_KEY=...
```

Why: those prefixes exist specifically to *inline the value into the client
bundle*. The variable is baked into the deployed JavaScript and, for many
setups, into build logs and preview deployments as well.

Keep the key in unprefixed server-only configuration (`POSTKIT_API_KEY`),
sourced only from Azure Key Vault (`ssd-global-kv-prod-ae`). A Function App
setting, if used, must be a Key Vault reference. Read it only in code that
never reaches the browser. In frameworks with a server/client split, assert the
module is server-only (e.g. a `server-only` import guard) so an accidental
client import fails the build rather than shipping the key.

### Do not let the browser choose the template or recipient

Treat `template`, `to`, `from`, `subject`, and any variable that appears in a
link or address as **server-owned**. If a submitted field with one of those
names arrives, ignore it — do not merge it into the `SendRequest`.

## Responsibilities PostKit does not take for you

The send endpoint (`apps/api/src/functions/send.ts`) validates only what it
needs in order to render and dispatch:

- `template` is a non-empty string matching `^[a-zA-Z0-9._-]+$` (path-traversal
  guard), and must resolve to a published artifact for the tenant.
- `to` matches a deliberately loose email shape (`^[^\s@]+@[^\s@]+\.[^\s@]+$`).
- `variables` is an object whose values are all strings.
- Every variable named in the template's `metadata.variables` is present.

That is the whole list. Everything below is **yours** to implement in the
trusted endpoint.

| Responsibility | Why it is yours |
| --- | --- |
| Input validation + length limits | PostKit does not cap variable length or reject junk content. Pick concrete limits — the repo's own contact path uses name ≤ 120, email ≤ 254, message 10–5000 characters (`packages/post-kit-email/src/contact/contact-email.ts`). |
| Spam / abuse mitigation | There is no captcha, honeypot, or bot heuristic anywhere in PostKit. A public form without one will be found and abused. |
| Rate limiting | **`POST /emails/send` does not rate-limit today — not per tenant, not per API key, not per recipient.** Nothing between your endpoint and the provider will stop a flood. |
| Template-key restriction | A credential can send *any* published template for its tenant. Your endpoint should hard-code, or allowlist, the one key that form is allowed to use. |
| Recipient selection | See below. |
| Origin restriction | PostKit does not check `Origin` on `/emails/send`. If your endpoint is called cross-origin, apply your own allowlist. |
| Error redaction | Map failures to a generic message before responding to the browser (see below). |

### Rate limiting — precedent in this repo

The anonymous `POST /contact` Function does have a limiter, and it is a
reasonable model for your endpoint (`apps/api/src/contact-rate-limit.ts`,
`apps/api/src/functions/contact.ts`):

- a sliding window keyed on the client IP, default **5 requests / 60s**
  (`CONTACT_RATE_LIMIT_PER_MIN`, `CONTACT_RATE_LIMIT_WINDOW_MS`);
- the client IP is derived from `X-Azure-ClientIP`, else the **last** hop of
  `X-Forwarded-For` (the socket peer on App Service / Consumption); untrusted
  `X-Client-IP` and `X-Real-IP` are ignored;
- on rejection it returns **429** with a `Retry-After` header.

Note the caveat stated in that file: the limiter is **process-local**, so it
resets on cold start and is enforced per instance after scale-out. It is
best-effort. If you need a real guarantee, put a shared store or an upstream
gateway limit in front of your endpoint.

### Origin restriction — precedent in this repo

`POST /contact` reflects `Origin` only when it matches the `ORIGINS` allowlist
(`apps/api/src/origins.ts`, `contactCorsHeaders`). Two things to copy, and one
trap to avoid:

- Copy: an explicit comma-separated allowlist, exact-host matching, and
  reflecting the request `Origin` with `Vary: Origin` rather than `*`.
- Copy: globs are constrained, not open. `origins.ts` deliberately refuses a
  bare `*.azurestaticapps.net` because that would allow any other tenant of the
  same hosting platform; only a named instance prefix is accepted.
- Trap: as the comment in `apps/api/src/contact.ts` says — **CORS is not
  authentication.** It is a browser-enforced policy. It does not stop `curl`, a
  server-side script, or a spoofed `Origin` header. Rate limiting, captcha, and
  validation are what actually protect the endpoint; origin restriction only
  keeps other people's *pages* from using it.

## Choosing the recipient

The destination address is a deployment decision, not user input. Read it from
server-side configuration (e.g. `CONTACT_TO_ADDRESS`) and pass that value to
`send()`.

If the browser can set `to`, your form is an open relay: an attacker sends
arbitrary rendered mail, from your verified domain, to anyone. The submitted
email address belongs in the **variables** (so the recipient can reply to it),
never in `to`.

For a waitlist confirmation the recipient *is* the submitted address, which is
the one case where user input reaches `to`. That is acceptable only with the
extra controls: validate strictly, cap the length, rate-limit per address as
well as per IP, send exactly one confirmation per submission, and use a
dedicated confirmation template. Never accept a list, and never accept
`to` under any other name (`cc`, `bcc`, `recipients`).

## Responding to the browser

Return a generic result. PostKit's own error responses carry a `code` and a
`correlationId` (`PostKitErrorResponse`), and `PostKitRequestError` exposes
`code`, `status`, and `correlationId` — that detail belongs in your **server
logs**, not in the HTTP response to an anonymous visitor.

- Success: `202` with a short acknowledgement.
- Invalid input: `400` with a field-level message you wrote yourself.
- Rate limited: `429` with `Retry-After`.
- Anything else (`PROVIDER_FAILURE`, `TEMPLATE_NOT_FOUND`, `UNAUTHORIZED`,
  `TIMEOUT`, `NETWORK_ERROR`): one generic `502`/`503`-class message. Log the
  `code` and `correlationId` server-side and correlate with the API's
  `X-Correlation-Id`.

Leaking `TEMPLATE_NOT_FOUND` or `UNAUTHORIZED` to the browser tells an attacker
which template keys exist and whether your credential is still valid.

## Checklist

- [ ] No PostKit credential appears in any file that can reach the browser.
- [ ] No `NEXT_PUBLIC_*` / `VITE_*` / `PUBLIC_*` variable holds the key.
- [ ] The browser posts form fields to your own endpoint, never a `SendRequest`.
- [ ] The endpoint hard-codes or allowlists the template key.
- [ ] The endpoint chooses the recipient from configuration.
- [ ] Caller-supplied `template` / `to` / `from` / `subject` fields are ignored.
- [ ] Input is validated with explicit length limits.
- [ ] Captcha or equivalent abuse mitigation is in place.
- [ ] The endpoint rate-limits, and you know whether that limiter survives
      scale-out.
- [ ] Cross-origin callers are restricted by an explicit allowlist, and you are
      not relying on CORS as authentication.
- [ ] Provider and PostKit error detail is logged, not returned.

## Related

- [`docs/architecture/overview.md`](../architecture/overview.md) — where the
  API, client, and provider sit.
- [`docs/email-forward-email.md`](../email-forward-email.md) — provider
  runtime, DNS, and the existing `POST /contact` Function.
- [`examples/marketing-contact-us/`](../../examples/marketing-contact-us/) —
  runnable handler and specs for this pattern.
