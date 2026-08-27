# Example: marketing-site "Contact Us"

A public marketing page collects `name`, `email`, and `message` and delivers it
through PostKit **without any PostKit credential existing in browser code**.

Full rationale, anti-patterns, and the security checklist:
[`docs/guides/public-forms.md`](../../docs/guides/public-forms.md).

This package is private and is never published.

## The pattern

```text
browser form  ──POST form fields──▶  YOUR server endpoint  ──PostKitClient──▶  PostKit API ──▶ provider
(no credential)                      (holds POSTKIT_API_KEY)
```

`src/contact-us-handler.ts` is the middle box, minus the framework. It is a
plain async function so you can mount it behind an Azure Function, a Next.js
route handler or server action, an Express route, or anything else, and test it
directly.

The security properties it enforces:

| Property | How |
| --- | --- |
| The credential stays server-side | The handler never reads env or builds a header. It receives an already-constructed `PostKitClient`; only your server wiring creates one. |
| The template key is server-owned | Hard-coded as `CONTACT_TEMPLATE_KEY` (`marketing.contact-us`). |
| The recipient is server-owned | Taken from `config.toAddress`, i.e. deployment configuration. The submitted address is passed as a *variable* so the team can reply. |
| Caller-supplied `template` / `to` / `from` / `subject` are ignored | Only `name`, `email`, and `message` are read off the submission; the `SendRequest` is built from scratch. |
| Input is validated with explicit limits | Name ≤ 120, email ≤ 254, message 10–5000 characters, control characters rejected — mirroring `packages/post-kit-email/src/contact/contact-email.ts`. |
| Failures do not leak provider detail | `PostKitRequestError.code` / `status` / `correlationId` go to `logError`; the browser gets one generic message. |

## Waitlist / whitelist signup

The same handler shape covers waitlist signup — swap the template key and the
variables. The one difference is that the confirmation goes *to the submitted
address*, so `to` comes from user input. That is the only case where it should,
and it needs the extra controls listed in the guide (strict validation, per
address rate limiting, one send per submission, a dedicated template). Never
accept a list of recipients.

## Run the specs

From the repo root:

```bash
pnpm --filter @singleton-sd/example-marketing-contact-us test
```

Or from this directory:

```bash
pnpm test
```

The specs inject a mock `fetch` into `PostKitClient`, so nothing leaves the
process: no network call, no email, no credential. The API key in the specs is
the literal string `test-key-not-a-real-credential`.

Covered: a valid submission sends with the server-chosen template and
recipient; caller-supplied `template`/`to` are ignored; ten malformed or
oversized inputs are rejected before any send; an HTTP failure and a network
failure both become a generic `502` while the diagnostic detail is logged.

## Wiring it up in a real deployment

```ts
import { PostKitClient } from '@singleton-sd/post-kit-client';
import { handleContactUs } from './contact-us-handler';

// Server-side module only — never imported from client code.
const client = new PostKitClient({
  endpoint: process.env.POSTKIT_ENDPOINT!,
  apiKey: process.env.POSTKIT_API_KEY!,
});

export async function POST(request: Request): Promise<Response> {
  // Your own concerns, before the handler: origin allowlist, rate limiting,
  // captcha verification. See the guide — PostKit does not do these for you,
  // and POST /emails/send is not rate-limited today.
  const submission = await request.json().catch(() => null);

  const result = await handleContactUs(submission, {
    client,
    config: { toAddress: process.env.CONTACT_TO_ADDRESS! },
    logError: (event, detail) => console.error(event, detail),
  });

  return Response.json(result.body, { status: result.status });
}
```

### Environment variables

Server-side only. None of these may be exposed to the browser — in particular
never under a `NEXT_PUBLIC_*`, `VITE_*`, or `PUBLIC_*` prefix.

| Variable | Purpose |
| --- | --- |
| `POSTKIT_ENDPOINT` | Base URL of the PostKit API. |
| `POSTKIT_API_KEY` | Bearer token for the PostKit API. Source it from a secret store (this repo uses Azure Key Vault); it resolves directly to a tenant and environment, so treat it as a full tenant credential. |
| `CONTACT_TO_ADDRESS` | Destination inbox for submissions. |

The specs need none of them.

## Template source

`content/email-templates/marketing.contact-us/` holds the template source
(`template.json`, `metadata.json`, `preview.json`) that the compiler and
publisher consume. `metadata.json` declares `name`, `email`, and `message`, so
the API rejects a send that omits any of them with `MISSING_VARIABLES`. The
compiled artifact must be published to the tenant's storage before the send
succeeds; otherwise the API returns `TEMPLATE_NOT_FOUND`.
