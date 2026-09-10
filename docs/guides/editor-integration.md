# Editor integration

How a consumer embeds [`@singleton-sd/post-kit-editor`](../../packages/post-kit-editor/README.md)
in a React admin application so an internal user can edit EmailBuilder.js
template sources, preview them, and persist changes through
**consumer-supplied** callbacks that ultimately feed the Git-backed publish
pipeline.

Template file layout and variables:
[`template-authoring.md`](./template-authoring.md). Publishing to Blob:
[`template-publishing.md`](./template-publishing.md).

A runnable minimal host lives in
[`examples/admin-editor/`](../../examples/admin-editor/).

## What the editor is (and is not)

`@singleton-sd/post-kit-editor` is a React **authoring surface** for the three
Git-backed source files under `content/email-templates/<key>/`:

| File | Role |
| --- | --- |
| `template.json` | EmailBuilder.js document |
| `metadata.json` | key, name, subject, variables, schemaVersion |
| `preview.json` | synthetic sample values for in-editor preview |

It holds those files **in memory**, offers canvas / metadata / preview-data /
validation UI, and calls consumer callbacks on Save (and optional Send-test).

It does **not**:

- send email or call the PostKit API
- accept API keys, tokens, or other credentials as props
- write to disk, Git, Azure Blob Storage, or the network
- run the publish pipeline (`post-kit-publish` / compiler content hashing)

Persistence and test delivery leave the package only through the props you pass
in. Production secrets stay in Azure Key Vault **`ssd-postkit-kv-prod-ae`**
(never in the admin browser bundle). Local development may use an uncommitted
`.env` copied from `.env.example` — never commit secrets.

## Installation and peers

```bash
pnpm add @singleton-sd/post-kit-editor
pnpm add react@^18.3.1 react-dom@^18.3.1
```

| Requirement | As shipped |
| --- | --- |
| React / React DOM | **Peer** `^18.3.1` — the host owns the React instance |
| Node (tooling / tests) | `>=20.18.1` |
| Module format | Published CommonJS (`main` / `types` / `exports`) |
| Bundler | Any React host (Vite, Next.js app route, etc.) that can resolve the package and its `@singleton-sd/post-kit-compiler/preview` dependency |

Cross-package install notes: [`packages.md`](./packages.md).

## Minimal embedding

Load the three source files (from your API, static imports, etc.), validate
them with `loadTemplateSource`, and mount `EmailTemplateEditor`:

```tsx
import {
  EmailTemplateEditor,
  loadTemplateSource,
  type SerializedTemplateSource,
  type TemplateSourceFiles,
} from '@singleton-sd/post-kit-editor';

const template = loadTemplateSource({
  templateJson /* from template.json */,
  metadata /* from metadata.json */,
  previewData /* from preview.json */,
});

export function TemplateAdminPage() {
  return (
    <EmailTemplateEditor
      template={template}
      availableVariables={[
        { name: 'name', label: 'Recipient name', description: 'Display name' },
      ]}
      onSave={async (serialized: SerializedTemplateSource, files: TemplateSourceFiles) => {
        // Persist via your trusted server — see Persistence below.
        const res = await fetch('/api/templates', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serialized, key: files.metadata.key }),
        });
        if (!res.ok) {
          return { ok: false, message: 'Save failed.' };
        }
      }}
    />
  );
}
```

While the host is still fetching files, pass `loading` or `loadError` so the
editor shows a non-interactive shell instead of a blank canvas.

### Public exports used for integration

| Export | Purpose |
| --- | --- |
| `EmailTemplateEditor` | Main React component |
| `loadTemplateSource` | Validate and normalize the working triple |
| `serializeTemplateSource` | Stable Git file strings (also used internally on Save) |
| `validateTemplate` / `hasValidationErrors` | Optional host-side validation |
| Types | `TemplateSourceFiles`, `SerializedTemplateSource`, `SaveResult`, `SendTestResult`, `ValidationIssue`, … |

There is **no** exported `PersistenceAdapter` interface. Persistence is the
`onSave` prop (and optionally `onSendTest`).

### Props that matter for embedding

| Prop | Required | Role |
| --- | --- | --- |
| `template` | yes | Seeded `TemplateSourceFiles` |
| `onSave` | yes | `(serialized, files) => SaveResult \| void \| Promise<…>` |
| `onSendTest` | no | When set, shows Send-test chrome; must hit **your** server |
| `availableVariables` | no | Catalogue entries for the editing user |
| `onDirtyChange` | no | Navigation guards while dirty |
| `onValidationChange` | no | Mirror validation in host chrome |
| `onPreviewRendered` | no | Successful preview HTML string |
| `loading` / `loadError` | no | Host fetch shells |
| `className` | no | Extra class on the root (`pk-editor-` prefix for CSS) |

Full props table: package
[README](../../packages/post-kit-editor/README.md).

## Persistence (consumer-owned)

On Save, the editor serializes working state and calls:

```ts
onSave(serialized: SerializedTemplateSource, files: TemplateSourceFiles)
```

`SerializedTemplateSource` is three stable strings ready for Git:

- `templateJson`
- `metadataJson`
- `previewJson`

`files` is the structured triple (`templateJson` object, `metadata`,
`previewData`). Return `{ ok: false, message }` (or throw / reject) so the
editor keeps dirty state; void / `{ ok: true }` marks success. HTTP helpers
that resolve on 4xx must check `res.ok` and return failure explicitly —
`fetch` does not reject on HTTP errors.

The package never loads or saves by itself. Your host:

1. **Loads** sources before mount (or while `loading` is true).
2. **Saves** inside `onSave` through your own API / Git integration.

### Worked note: PR-backed Git commit

Typical production path for reviewed templates:

1. Admin UI calls your trusted server with `serialized` (and/or `files`).
2. Server writes (or opens a PR that writes)  
   `content/email-templates/<key>/{template,metadata,preview}.json` in the
   **consumer** repository.
3. Humans review and merge the PR.
4. Consumer CI runs `post-kit-publish` → Blob (see
   [`template-publishing.md`](./template-publishing.md)).

The editor never talks to GitHub or Azure; only your server and CI do.

### Worked note: staging store before promotion

Some teams stage drafts outside the publish branch:

1. `onSave` writes the serialized triple to a consumer-owned store (DB, blob
   prefix, or draft branch) keyed by template key / draft id.
2. A separate “promote” action copies validated drafts into
   `content/email-templates/<key>/` (or opens the PR) when ready.
3. Only the promoted sources enter the publish pipeline.

Keep staging credentials and PostKit send credentials on the server. The
browser only talks to your admin API with the user’s session.

See [`examples/admin-editor/`](../../examples/admin-editor/) for an
in-memory load/save adapter that mirrors the callback contract without I/O.

## Preview vs send-time Handlebars

In-editor preview uses `@singleton-sd/post-kit-compiler/preview`
`renderPreview`: EmailBuilder HTML, then Handlebars substitution with
**`preview.json` sample values**. That is the same EmailBuilder + Handlebars
path the compiler uses when validating at publish time.

It is **not** identical to what a recipient sees at send time:

| Concern | In-editor preview | Publish artifact / send |
| --- | --- | --- |
| Variable values | From committed `preview.json` | From the send request’s `variables` |
| HTML in Blob | N/A (preview only) | `template.html` keeps `{{placeholders}}` unsubstituted |
| Substitution timing | Immediate in the preview pane | Handlebars at send time on subject + body |
| Content hashing / filesystem | Browser-safe preview entry only | Full `compile()` in CI / publisher |
| Preview iframe | Restrictive CSP (`connect-src 'none'`, `img-src data:` only) | Delivered as email HTML by the provider |

Treat preview as a layout and variable-coverage check with synthetic data
(`Jane Doe`, `jane@example.com`), not as a guarantee of pixel-identical send
output for every request payload. Escaping and Handlebars rules for send are
documented in [`template-authoring.md`](./template-authoring.md).

Optional `onSendTest` must POST to **your** trusted server; that server may
call `@singleton-sd/post-kit-client` with secrets from Azure Key Vault
`ssd-postkit-kv-prod-ae` (or local uncommitted `.env` from `.env.example`).
Omitting `onSendTest` hides Send-test chrome entirely.

## Lifecycle: editor → PR → Blob → send

```text
Admin embeds EmailTemplateEditor
        │  onSave → consumer persistence
        ▼
content/email-templates/<key>/   (consumer repo)
        │  PR review + merge
        ▼
consumer CI → post-kit-publish → Azure Blob
        │
        ▼
PostKit API loads Blob at send time
```

- Authoring file rules: [`template-authoring.md`](./template-authoring.md)
- Publish flags, blob layout, environments:
  [`template-publishing.md`](./template-publishing.md)
- System narrative: [`architecture/template-lifecycle.md`](../architecture/template-lifecycle.md)

## Access control

- The editor is an **internal admin** surface. Your admin app owns
  authentication and authorisation (who may open which templates, who may
  save, who may trigger Send-test).
- Do **not** put a long-lived PostKit send credential (or
  `@singleton-sd/post-kit-client` configured with a real API key) in the
  browser bundle.
- Browser → your admin API (session / SSO). Server → PostKit / Git / staging
  store with secrets from Azure Key Vault `ssd-postkit-kv-prod-ae` (production)
  or a local uncommitted `.env` copied from `.env.example` (development only).

Public marketing forms are a different pattern; see
[`public-forms.md`](./public-forms.md).
