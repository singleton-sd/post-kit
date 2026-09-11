# Example: marketing-site waitlist signup

A public form collects an email (optional name) and sends a **confirmation to
the signup address** through PostKit — without any PostKit credential in
browser code.

Full rationale: [`docs/guides/public-forms.md`](../../docs/guides/public-forms.md).
Contact Us (inbox recipient) is
[`examples/marketing-contact-us/`](../marketing-contact-us/).

This package is private and is never published.

## The pattern

```text
browser form  ──POST email (+ name)──▶  YOUR server endpoint  ──PostKitClient──▶  PostKit API
(no credential)                         (holds POSTKIT_API_KEY; to = signup email)
```

`src/waitlist-handler.ts` is the middle box, minus the framework.

| Property | How |
| --- | --- |
| Credential stays server-side | Injected `PostKitClient` only |
| Template key is server-owned | `WAITLIST_TEMPLATE_KEY` (`marketing.waitlist-confirm`) |
| Recipient is the signup email | Validated `email` becomes `to` — the **only** case where user input reaches `to` |
| Caller `template` / `to` / `from` / `subject` ignored | Built from scratch |
| Name optional | Empty → display fallback `"there"` |

### Host duties (not implemented here)

Production must still: captcha / abuse mitigation, rate-limit per IP **and**
per address, one confirmation per submission, dedicated published template.

## Run the specs

```bash
pnpm --filter @singleton-sd/example-marketing-waitlist test
```

## Wiring sketch

```ts
import { PostKitClient } from '@singleton-sd/post-kit-client';
import { handleWaitlistSignup } from './waitlist-handler';

const client = new PostKitClient({
  endpoint: process.env.POSTKIT_ENDPOINT!,
  apiKey: process.env.POSTKIT_API_KEY!,
});

export async function POST(request: Request): Promise<Response> {
  // captcha + rate limits first
  const submission = await request.json().catch(() => null);
  const result = await handleWaitlistSignup(submission, {
    client,
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
| `POSTKIT_API_KEY` | Tenant Bearer credential. In production source it **only** from Azure Key Vault `ssd-postkit-kv-prod-ae`; any Function App setting must be a Key Vault reference. Never ship it in browser code. |

The specs need none of them.

## Template source

`content/email-templates/marketing.waitlist-confirm/` — publish with
`post-kit-publish` before sends succeed.
