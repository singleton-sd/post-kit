# `@singleton-sd/post-kit-client`

Thin typed SDK for **trusted server-side** Node.js / TypeScript consumers calling
the PostKit API (`POST /emails/send`).

## Server-side only

Do **not** ship this package (or long-lived `POSTKIT_API_KEY` values) to the
browser. Public contact forms and other client UIs must POST to **your own
server endpoint**; that intermediary then uses `PostKitClient` with
`POSTKIT_API_KEY` from Azure Key Vault (`ssd-global-kv-prod-ae`) only — never
from browser code or long-lived app settings.

## Install

```bash
pnpm add @singleton-sd/post-kit-client
```

## Usage

```ts
import { PostKitClient } from '@singleton-sd/post-kit-client';

const postKit = new PostKitClient({
  endpoint: process.env.POSTKIT_URL!,
  apiKey: process.env.POSTKIT_API_KEY!,
});

await postKit.send({
  template: 'marketing.contact-us',
  to: 'hello@example.com',
  variables: { name, email, message },
});
```

### Options

| Option | Description |
| --- | --- |
| `endpoint` | Base URL of the PostKit API (trailing slash stripped) |
| `apiKey` | Bearer token for `Authorization` |
| `timeout` | Request timeout ms (default `30_000`). Pass `0` to disable; with no per-call `AbortSignal`, the request then runs indefinitely |
| `fetch` | Injectable `fetch` (for tests); defaults to `globalThis.fetch` |

Auth lives on the constructor so the strategy can evolve without changing
`send()`.

### Errors

Non-2xx responses and client-side failures throw `PostKitRequestError`:

- `status` — HTTP status when available
- `code` — API `PostKitErrorCode`, or `'TIMEOUT'` / `'NETWORK_ERROR'`
- `correlationId` — from the error body when present

```ts
import { PostKitClient, PostKitRequestError } from '@singleton-sd/post-kit-client';

try {
  await postKit.send(request, { signal: AbortSignal.timeout(5_000) });
} catch (err) {
  if (err instanceof PostKitRequestError) {
    console.error(err.code, err.status, err.correlationId);
  }
  throw err;
}
```

Request/response bodies use types from `@singleton-sd/post-kit-types`
(`SendRequest`, `SendResponse`, `PostKitErrorResponse`).

## Development

```bash
pnpm test
pnpm build
```
