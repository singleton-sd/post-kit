# Minimal `@singleton-sd/post-kit-editor` integration

Single-file example that wires the public editor API to synthetic sample
template sources. There is no app shell, router, styling framework, or mock
backend — copy `App.tsx` into your host and replace the `onSave` /
`onSendTest` stubs with calls to **your** trusted server.

## Layout

```text
examples/minimal/
  App.tsx                 # EmailTemplateEditor + callbacks
  sample/
    template.json         # EmailBuilder document (from package fixtures)
    metadata.json
    preview.json          # synthetic preview values only
  README.md
```

`sample/` is a copy of `src/__fixtures__/nested-blocks/` so the example stays
aligned with the serialization fixtures. Values are generic (`Jane Doe`,
`test.nested`) — never put real personal data here.

## Callbacks (current API)

| Callback | Signature |
| --- | --- |
| `onSave` | `(serialized, files) => …` |
| `onSendTest` | `(serialized, files, recipient) => …` |

`serialized` is the three Git file strings (`templateJson`, `metadataJson`,
`previewJson`). `files` is the structured working triple.

## What this example does not do

- No filesystem or Git writes
- No HTTP calls, credentials, or PostKit API keys
- No publish / compile pipeline (use `@singleton-sd/post-kit-compiler` on the server or in CI)

See the package [README](../../README.md) for the full props table.
