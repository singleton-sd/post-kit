# Example: backend password-reset send

Minimal, testable example of sending a transactional email from a trusted
server with [`@singleton-sd/post-kit-client`](../../packages/post-kit-client).
Not a demo app: no HTTP server, no framework, no build output.

Quick start guide: [`docs/guides/api-quickstart.md`](../../docs/guides/api-quickstart.md).

## What this proves

- A single function, `sendPasswordReset(client, { email, resetUrl, name })`,
  calls `client.send()` with template key `auth.password-reset`.
- Every `variables` value is a string, which is what
  `POST /emails/send` requires.
- `PostKitRequestError` is translated into a typed result the caller can act
  on: `sent`, `retryable` (transient provider/storage failure, timeout,
  network error), or `permanent` (validation, auth, template not found).
- The spec covers a successful send, a non-2xx mapped error, and a timeout
  using an **injected mock `fetch`** — no test performs a real HTTP call and
  no email is ever sent.

## Server-side only

`POSTKIT_API_KEY` is a long-lived credential. It comes from Azure Key Vault
(`ssd-global-kv-prod-ae`) and must never appear in browser code, a client
bundle, or a committed file. Browser UIs POST to your own server endpoint,
which then calls PostKit.

## Run the tests

From the repository root:

```bash
pnpm --filter @singleton-sd/example-backend-password-reset test
```

`pnpm test` at the root runs it too.

## Point it at a real endpoint

Nothing in this package reads env vars itself — the caller constructs the
client, so you choose where configuration comes from:

```ts
import { PostKitClient } from '@singleton-sd/post-kit-client';
import { sendPasswordReset } from './src/send-password-reset';

const client = new PostKitClient({
  endpoint: process.env.POSTKIT_URL!,
  apiKey: process.env.POSTKIT_API_KEY!,
});

const result = await sendPasswordReset(client, {
  email: 'jane@example.com',
  resetUrl: 'https://app.example.com/reset?token=<single-use-token>',
  name: 'Jane Doe',
});
```

| Env var | Meaning |
| --- | --- |
| `POSTKIT_URL` | Base URL of the PostKit API, e.g. `https://<function-app>.azurewebsites.net/api` |
| `POSTKIT_API_KEY` | Tenant API key from Key Vault `ssd-global-kv-prod-ae` |

A real send also needs the template published to the tenant's storage under
the key `auth.password-reset`, otherwise the API answers `404` /
`TEMPLATE_NOT_FOUND`.

## Template source

`content/email-templates/auth.password-reset/` holds the three source files
PostKit compiles (`template.json`, `metadata.json`, `preview.json`).
`metadata.json` declares `variables: ["name", "resetUrl"]`, which is exactly
what `sendPasswordReset` sends — a mismatch surfaces at runtime as
`MISSING_VARIABLES`.
