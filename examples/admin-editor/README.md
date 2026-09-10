# Example: admin editor embedding

Minimal, testable host for
[`@singleton-sd/post-kit-editor`](../../packages/post-kit-editor): a React
embedding plus an in-memory persistence adapter. Not a full admin app — no
router, auth UI, or HTTP server.

Guide: [`docs/guides/editor-integration.md`](../../docs/guides/editor-integration.md).

## What this proves

- `App.tsx` mounts `EmailTemplateEditor` with synthetic sample sources
  (`jane@example.com` only).
- `createMemoryPersistence` implements load/save around the package’s real
  contract: `onSave(serialized, files)` and structured `TemplateSourceFiles`.
- The adapter spec covers load after seed, save round-trip, and a save failure
  surfaced to the caller — no browser / jsdom.

## What this does not do

- No PostKit send credentials or `@singleton-sd/post-kit-client`
- No Git, Blob, or network I/O
- No `onSendTest` (Send-test chrome stays hidden)

## Layout

```text
examples/admin-editor/
  App.tsx                         # EmailTemplateEditor + memory adapter
  sample/                         # synthetic template / metadata / preview
  src/
    memory-persistence.ts         # in-memory load/save
    memory-persistence.spec.ts
  package.json                    # private
  README.md
```

## Run the tests

From the repository root:

```bash
pnpm --filter @singleton-sd/example-admin-editor test
```

`pnpm test` at the root runs it too.

## Copy into a real host

1. Copy `App.tsx` (or the pattern) into your React admin route.
2. Replace `createMemoryPersistence` with a server-backed load/save that
   writes `content/email-templates/<key>/` (or opens a PR / staging store).
3. Optionally add `onSendTest` that POSTs to **your** trusted server only.
