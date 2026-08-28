# API / client quick start

Zero to a working transactional send against the PostKit API, from a trusted
backend. Read this if you are wiring a server-side service to
`POST /emails/send`, either through `@singleton-sd/post-kit-client` or raw
HTTP.

Working example: [`examples/backend-password-reset/`](../../examples/backend-password-reset/README.md).

## Server-side only

The API key is a long-lived tenant credential:

- It is stored in Azure Key Vault (`ssd-global-kv-prod-ae`) and injected into
  your service's environment at deploy time. It must never be committed, and
  never pasted into an issue, PR, or log line.
- It must **never appear in browser code** — not in a bundle, not in a
  `NEXT_PUBLIC_*`-style variable, not in an inline script. Public UIs POST to
  your own server endpoint, which then calls PostKit with the key.

## Prerequisites

1. A tenant API key (Key Vault, as above), exposed to your process as
   `POSTKIT_API_KEY`.
2. The API base URL, e.g.
   `https://<function-app>.azurewebsites.net/api`, as `POSTKIT_URL`.
3. A compiled template published to the tenant's storage. The template key is
   what you pass as `template`; an unpublished key returns `404` /
   `TEMPLATE_NOT_FOUND`.

## The HTTP contract

`POST {POSTKIT_URL}/emails/send`

### Request headers

| Header | Required | Notes |
| --- | --- | --- |
| `Authorization` | yes | `Bearer <POSTKIT_API_KEY>`. The tenant is resolved server-side from this credential |
| `Content-Type` | yes | `application/json` |
| `x-correlation-id` | no | Your own trace id. If omitted the API generates one |

Tenant identity is never sent in the body.

### Request body — `SendRequest`

```json
{
  "template": "auth.password-reset",
  "to": "jane@example.com",
  "variables": {
    "name": "Jane Doe",
    "resetUrl": "https://app.example.com/reset?token=<single-use-token>"
  }
}
```

| Field | Type | Rules |
| --- | --- | --- |
| `template` | `string` | Non-empty; only `A-Z a-z 0-9 . _ -` (path characters are rejected) |
| `to` | `string` | Single recipient address, basic `local@domain.tld` validation |
| `variables` | `Record<string, string>` | A JSON object whose **every value is a string**. A number, boolean, or nested object is rejected with `MISSING_VARIABLES`. Must cover every name in the template's `metadata.json` `variables` (tenant branding defaults can satisfy some of them) |

### Success response — `SendResponse`

`200 OK`, with an `X-Correlation-Id` response header:

```json
{ "id": "3f6a0f2e-...", "status": "sent" }
```

`id` is the correlation id of the send — record it. `status` is always
`"sent"` on a 200.

### Error response — `PostKitErrorResponse`

Any non-2xx status returns:

```json
{
  "error": "Template not found",
  "code": "TEMPLATE_NOT_FOUND",
  "correlationId": "3f6a0f2e-..."
}
```

Branch on `code`, never on `error` text.

## `curl`

The same request without Node:

```bash
curl -sS -X POST "$POSTKIT_URL/emails/send" \
  -H "Authorization: Bearer $POSTKIT_API_KEY" \
  -H 'Content-Type: application/json' \
  -H "x-correlation-id: $(uuidgen)" \
  -d '{
    "template": "auth.password-reset",
    "to": "jane@example.com",
    "variables": {
      "name": "Jane Doe",
      "resetUrl": "https://app.example.com/reset?token=REPLACE_ME"
    }
  }'
```

Read both variables from the environment; do not inline the key.

## The `PostKitClient` equivalent

```bash
pnpm add @singleton-sd/post-kit-client
```

```ts
import { PostKitClient } from '@singleton-sd/post-kit-client';

const postKit = new PostKitClient({
  endpoint: process.env.POSTKIT_URL!,
  apiKey: process.env.POSTKIT_API_KEY!,
});

const result = await postKit.send({
  template: 'auth.password-reset',
  to: 'jane@example.com',
  variables: {
    name: 'Jane Doe',
    resetUrl: 'https://app.example.com/reset?token=REPLACE_ME',
  },
});

console.log(result.id, result.status); // "<correlation-id> sent"
```

That produces byte-for-byte the request the `curl` above does (minus
`x-correlation-id`, which the client does not currently set — pass your trace
id via raw HTTP if you need to control it).

### Constructor options

| Option | Default | Notes |
| --- | --- | --- |
| `endpoint` | — | Required. Base URL; a trailing slash is stripped. `send()` appends `/emails/send` |
| `apiKey` | — | Required. Sent as `Authorization: Bearer` |
| `timeout` | `30_000` | Milliseconds. `0` disables the client timeout — the request then runs until your own `AbortSignal` fires, or indefinitely |
| `fetch` | `globalThis.fetch` | Injectable `fetch`. Use it in tests so no socket is opened |

Both `endpoint` and `apiKey` throw synchronously from the constructor if
empty.

### `send(request, options?)`

`send(request: SendRequest, options?: { signal?: AbortSignal })` resolves to
`SendResponse` or throws `PostKitRequestError`. A per-call `signal` is combined
with the client timeout, so whichever fires first wins:

```ts
await postKit.send(request, { signal: AbortSignal.timeout(5_000) });
```

If **your** signal aborts, the original `AbortError` propagates unchanged; if
the client's own timeout fires, you get a `PostKitRequestError` with code
`TIMEOUT`.

### `PostKitRequestError`

| Property | Meaning |
| --- | --- |
| `code` | A `PostKitErrorCode` from the API body, or `'TIMEOUT'` / `'NETWORK_ERROR'`, or `HTTP_<status>` when the error body was not JSON |
| `status` | HTTP status; `undefined` for timeouts and network failures |
| `correlationId` | From the error body when present — log it |
| `message` | The API's `error` text, or a generated fallback |

## Error handling and retries

| `code` | Typical status | Retry? | What to do |
| --- | --- | --- | --- |
| `UNAUTHENTICATED` | 401 | no | Credential missing or malformed — check the `Authorization` header |
| `UNAUTHORIZED` | 403 | no | Well-formed key that maps to no tenant — the key was rotated or is for another environment |
| `INVALID_RECIPIENT` | 400 | no | `to` failed validation, or the body was not a JSON object |
| `INVALID_TEMPLATE` | 400 | no | `template` missing, unsafe, or the stored artifact is unparseable |
| `MISSING_VARIABLES` | 400 | no | A declared variable is absent, or a value was not a string |
| `TEMPLATE_NOT_FOUND` | 404 | no | Publish the template for this tenant first |
| `STORAGE_FAILURE` | 503 / 500 | yes on 503 | Configuration or template storage is temporarily unavailable |
| `PROVIDER_FAILURE` | 503 | yes | Transient provider error, rate limit, or provider misconfiguration |
| `PROVIDER_FAILURE` | 502 / 500 | no | Provider rejected the message permanently, or an unexpected server error — investigate with the correlation id |
| `TIMEOUT` | — | yes (idempotent) | Client-side timeout; delivery status is unknown — the send may still have happened |
| `NETWORK_ERROR` | — | yes (idempotent) | Transport failure or a response-body read failure after headers arrived; delivery status is unknown — the API may have accepted the send before the body failed |

Retry the "yes" rows with capped exponential backoff and jitter. Treat both
`TIMEOUT` and `NETWORK_ERROR` as **delivery unknown** — make retries idempotent
at your layer. Never retry a 4xx — the same request will fail identically.

```ts
import { PostKitRequestError } from '@singleton-sd/post-kit-client';
import { PostKitErrorCode } from '@singleton-sd/post-kit-types';

try {
  await postKit.send(request);
} catch (err) {
  if (!(err instanceof PostKitRequestError)) throw err;

  // Log the correlation id — support needs it to find the send server-side.
  logger.error('postkit.send.failed', {
    code: err.code,
    status: err.status,
    correlationId: err.correlationId,
  });

  const retryable =
    err.code === 'TIMEOUT' ||
    err.code === 'NETWORK_ERROR' ||
    ((err.code === PostKitErrorCode.STORAGE_FAILURE ||
      err.code === PostKitErrorCode.PROVIDER_FAILURE) &&
      err.status === 503);
  if (retryable) {
    // schedule a retry with backoff
  }
}
```

`PROVIDER_FAILURE` and `STORAGE_FAILURE` are retryable only on HTTP 503, not
on 502 or 500.

### Logging for support

Log `code`, `status`, and `correlationId` on every failure, and `id` on every
success — both are the same correlation id the API logs, and it is the only
handle that ties your request to the server-side trace. Never log the API key,
the rendered email, or a reset/verification URL.

## Where to go next

- [`examples/backend-password-reset/`](../../examples/backend-password-reset/README.md)
  — runnable version of everything above, with specs against a mock `fetch`.
- [`packages/post-kit-client/README.md`](../../packages/post-kit-client/README.md)
  — SDK reference.
- [`docs/architecture/overview.md`](../architecture/overview.md) — how the API,
  template storage, and email provider fit together.
