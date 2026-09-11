# Example: admin editor + Send-test BFF

Reference host for embedding
[`@singleton-sd/post-kit-editor`](../../packages/post-kit-editor) in a
**consumer** admin app (InkAds back-office, etc.). PostKit does not host an
admin CMS — your app owns list/load/save auth and Git; this example shows the
wiring.

Guide: [`docs/guides/editor-integration.md`](../../docs/guides/editor-integration.md).

## Topology (1:1 with a real admin)

```text
Admin browser
  → EmailTemplateEditor (onSave / onSendTest callbacks only)
  → Your admin API (session / SSO — not PostKit API keys)
       ├─ list/load/save → content/email-templates/… (or open a PR)
       └─ POST …/send-test → PostKitClient + POSTKIT_API_KEY → PostKit API
Consumer CI
  → post-kit-publish → Blob (template must be published before Send-test works)
```

Never put `POSTKIT_API_KEY` in a browser bundle.

## What this proves

| Piece | Location |
| --- | --- |
| List / load / save on disk | `src/template-store.ts` + seeded `content/email-templates/` |
| Save stub + PR reminder | `src/save-stub.ts` |
| React host (list select + editor) | `App.tsx` (in-memory save for the UI demo) |
| Send-test BFF handler | `src/send-test-handler.ts` |
| Env → `PostKitClient` | `src/create-client-from-env.ts` |
| In-memory adapter (UI contract) | `src/memory-persistence.ts` |

## Environment (server only)

| Variable | Purpose |
| --- | --- |
| `POSTKIT_API_BASE_URL` | PostKit API base URL |
| `POSTKIT_API_KEY` | Bearer credential from the **consumer** secret store |

Send-test targets the Blob templates for the tenant/environment bound to that
key. Draft-only Git files are not sendable until publish CI has run.

## Wire the BFF (Express-style sketch)

Gate the route (and the editor callback) on the same env boundary. When env is
incomplete, omit `sendTest` on `AdminEditorExample` so Send-test chrome stays
hidden — do not default the browser handler on.

```ts
import express from 'express';
import {
  createPostKitClientFromEnv,
  isSendTestEnvConfigured,
} from './create-client-from-env';
import { handleSendTest } from './send-test-handler';

const app = express();
app.use(express.json());

app.post('/api/email-templates/send-test', async (req, res) => {
  if (!isSendTestEnvConfigured()) {
    res.status(503).json({ error: 'Send-test is not configured.' });
    return;
  }
  const client = createPostKitClientFromEnv();
  const result = await handleSendTest(req.body, {
    client,
    logError: (event, detail) => console.error(event, detail),
  });
  res.status(result.status).json(result.body);
});
```

When the BFF is configured, pass `sendTest={postSendTestToBff}` into
`AdminEditorExample` (POST `{ templateKey, to, variables }` — no secrets).

## Map to InkAds (or any) admin

1. Embed `EmailTemplateEditor` on an authenticated admin route (your SSO/RBAC).
2. List/load from your Git tree or admin API (`createFsTemplateStore` pattern).
3. `onSave` → trusted server → commit or GitHub App PR (this example writes
   locally and logs a PR reminder via `toFsOnSave`).
4. `onSendTest` → your BFF → `handleSendTest` + `createPostKitClientFromEnv`.
5. Publish CI: adapt [`docs/examples/publish-email-templates.yml`](../../docs/examples/publish-email-templates.yml).
6. Per-environment keys so Send-test hits the right Blob prefix.

## Layout

```text
examples/admin-editor/
  App.tsx
  sample/                         # single-template fixture for memory tests
  content/email-templates/        # multi-template list/load/save seed
  src/
    memory-persistence.ts
    template-store.ts
    save-stub.ts
    send-test-handler.ts
    create-client-from-env.ts
    *.spec.ts
```

## Run the tests

From the repository root:

```bash
pnpm --filter @singleton-sd/example-admin-editor test
```

## What this does not do

- Real GitHub App / PR creation
- Consumer SSO/RBAC
- Live HTTP server in this package (handler is framework-agnostic)
- Browser-held PostKit credentials
