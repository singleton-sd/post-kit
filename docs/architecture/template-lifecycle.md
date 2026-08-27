# Template lifecycle

How an email template travels from an editable source file in a consumer
repository to the HTML the API renders at send time.

Implemented in [`packages/post-kit-compiler`](../../packages/post-kit-compiler/),
[`packages/post-kit-publisher`](../../packages/post-kit-publisher/), and
[`apps/api/src/templates/blob-template-store.ts`](../../apps/api/src/templates/blob-template-store.ts).

## Source files

A template is a directory containing exactly three files. All three are
required — `post-kit-publish` refuses to run if any is missing.

| File            | Contents                                                                             |
| --------------- | ------------------------------------------------------------------------------------ |
| `template.json` | EmailBuilder.js reader document (an object with a `root` block). The editable source. |
| `metadata.json` | `TemplateSourceMetadata`: `key`, `name`, `subject`, optional `description`, `variables[]`, `schemaVersion` (must equal `TEMPLATE_SCHEMA_VERSION`, currently `"1"`). |
| `preview.json`  | `TemplatePreviewData` — a sample string value for every name in `variables`. Never real personal data or secrets. |

The `subject` may contain `{{variable}}` placeholders using the same syntax as
the body.

## Flow

```text
Consumer repository
  content/email-templates/<dir>/{template.json, metadata.json, preview.json}
        |
        |  edit (by hand today; the editor package is not implemented — see #5)
        v
Pull request in the consumer repository
        |
        v
Consumer CI
        |
        +-- post-kit-compiler: compileFromDirectory(dir)
        |       1. validate metadata shape + schemaVersion
        |       2. every metadata.variables entry must exist in preview.json
        |       3. render HTML via @usewaypoint/email-builder renderToStaticMarkup
        |       4. Handlebars render of subject and HTML against preview data
        |          (validation only — the stored HTML keeps {{placeholders}})
        |       5. contentHash = sha256(templateHtml)
        |
        +-- post-kit-publish (post-kit-publisher CLI)
        |       assert tenant / environment / storage account / template key are safe
        |       compile every subdirectory first — fail-fast, nothing uploads
        |       if any compile fails
        |       reject duplicate template keys across directories
        |       upload with DefaultAzureCredential (Managed Identity / az login)
        v
Azure Blob Storage container (TEMPLATE_STORAGE_CONTAINER, default `templates`)
  tenants/{tenantId}/{environment}/templates/{templateKey}/template.html
  tenants/{tenantId}/{environment}/templates/{templateKey}/metadata.json
        |
        |  at send time
        v
apps/api BlobTemplateStore.load(tenant, templateKey)
        downloads both blobs in parallel, re-validates metadata,
        returns CompiledTemplate to the send handler
```

## Blob layout

Exactly as produced by `blobBasePath()` in `post-kit-publisher` and consumed
by `BlobTemplateStore`:

```text
tenants/{tenantId}/{environment}/templates/{templateKey}/template.html
tenants/{tenantId}/{environment}/templates/{templateKey}/metadata.json
```

Example for a placeholder tenant `acme`:

```text
tenants/acme/production/templates/marketing.contact-us/template.html
tenants/acme/production/templates/marketing.contact-us/metadata.json
```

`{environment}` is one of `development`, `staging`, `production`. The path is
the isolation boundary — see
[`multi-tenant-security.md`](./multi-tenant-security.md).

Uploaded content types are `text/html; charset=utf-8` for `template.html` and
`application/json; charset=utf-8` for `metadata.json`. `metadata.json` is the
compiler's validated `TemplateSourceMetadata`, pretty-printed with two-space
indentation.

## Publishing

```bash
post-kit-publish \
  --templates ./content/email-templates \
  --tenant acme \
  --environment production \
  --storage-account <storage-account-name> \
  --container templates \
  --commit "$GITHUB_SHA"
```

Behaviour worth knowing:

- Every immediate subdirectory of `--templates` is one template, processed in
  sorted order.
- Compilation happens for all templates before any upload. If one fails, the
  CLI prints `FAILED <dir>: <reason>` for each failure, exits `1`, and
  uploads nothing.
- Uploads are per-template and not transactional — a storage error partway
  through leaves earlier templates published.
- Each successful upload prints a JSON line with `key`, `contentHash`, and
  both blob paths, so CI logs record what was published.
- `--commit` is recorded as `TemplateManifest.sourceCommit`.

## Manifest and change detection

`post-kit-compiler` produces a `TemplateManifest` with `key`,
`schemaVersion`, `compiledAt`, `sourceCommit`, `variables`, and a SHA-256
`contentHash` of the rendered HTML (`compiledAt` is deliberately excluded
from the hash so identical content hashes stably).

The manifest is **not** persisted as its own blob. Only `template.html` and
`metadata.json` are uploaded, so `BlobTemplateStore.load()` reconstructs a
manifest at read time with `compiledAt`, `sourceCommit`, and `contentHash`
set to empty strings. Provenance for a published artifact therefore has to
come from the publish CI logs, not from Blob Storage.

## Validation at read time

`BlobTemplateStore` does not trust what is in the container. On every load it:

1. Re-validates the template key against `/^[a-zA-Z0-9._-]+$/` and rejects
   the bare dot-segments `.` and `..`.
2. Requires `metadata.json` to parse and to have string `key`, `name`,
   `subject`, `schemaVersion`, and a string array `variables`.
3. Requires `metadata.key` to equal the requested template key.
4. Requires `metadata.schemaVersion` to equal `TEMPLATE_SCHEMA_VERSION`.

Failures 2–4 surface to the caller as `400 INVALID_TEMPLATE`; a missing blob
surfaces as `404 TEMPLATE_NOT_FOUND`. See
[`request-lifecycle.md`](./request-lifecycle.md).

## Not yet implemented

- **Editor** — `@singleton-sd/post-kit-editor` does not exist. Template JSON
  is authored by hand or with an external EmailBuilder.js instance. Tracked
  by [#5](https://github.com/singleton-sd/post-kit/issues/5).
- **A reusable publish workflow** — this repository ships no reusable GitHub
  Actions workflow or composite action for consumer template publishing.
  Consumers wire `post-kit-publish` into their own CI. Onboarding and
  end-to-end examples are tracked by
  [#7](https://github.com/singleton-sd/post-kit/issues/7).
- **Template deletion / unpublish** — the publisher only uploads. Removing a
  template directory from source does not remove its blobs.
