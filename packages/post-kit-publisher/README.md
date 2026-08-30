# @singleton-sd/post-kit-publisher

Compile Git-backed PostKit email templates and publish runtime artifacts to Azure Blob Storage for `apps/api` TemplateStore.

Authoring template source files is covered in [`docs/guides/template-authoring.md`](../../docs/guides/template-authoring.md). Publishing flags, blob layout, CI setup, and RBAC are in [`docs/guides/template-publishing.md`](../../docs/guides/template-publishing.md).

## Install

```bash
pnpm add @singleton-sd/post-kit-publisher
```

## Template source

Each template is a subdirectory of `--templates` containing `template.json`, `metadata.json`, and `preview.json`. The compiler requires an EmailBuilder.js document with a **`root` block** in `template.json`:

```json
{
  "root": {
    "type": "EmailLayout",
    "data": {
      "backdropColor": "#F8F8F8",
      "canvasColor": "#FFFFFF",
      "textColor": "#242424",
      "fontFamily": "MODERN_SANS",
      "childrenIds": ["block-text"]
    }
  },
  "block-text": {
    "type": "Text",
    "data": {
      "style": {
        "fontWeight": "normal",
        "padding": { "top": 16, "bottom": 16, "right": 24, "left": 24 }
      },
      "props": {
        "text": "Hello {{name}}, from {{email}}: {{message}}"
      }
    }
  }
}
```

See [`template-authoring.md`](../../docs/guides/template-authoring.md) for `metadata.json`, `preview.json`, variables, and a full worked example.

## CLI

```bash
post-kit-publish \
  --templates ./content/email-templates \
  --tenant acme \
  --environment production \
  --storage-account examplestorageacct \
  --container templates \
  --commit "$GITHUB_SHA"
```

Auth uses `DefaultAzureCredential` (Managed Identity in CI, `az login` locally). No connection strings.

Blob layout (must match TemplateStore):

```text
tenants/{tenant}/{environment}/templates/{templateKey}/template.html
tenants/{tenant}/{environment}/templates/{templateKey}/metadata.json
```

If any template fails to compile, the CLI exits non-zero and uploads nothing.

## Library

```ts
import { publishTemplates } from '@singleton-sd/post-kit-publisher';

const result = await publishTemplates({
  templatesDir: './content/email-templates',
  tenant: 'acme',
  environment: 'production',
  storageAccount: 'examplestorageacct',
  container: 'templates',
  commit: process.env.GITHUB_SHA,
});
```

## GitHub Actions (OIDC)

See [`docs/guides/template-publishing.md`](../../docs/guides/template-publishing.md) and the copy-pasteable workflow at [`docs/examples/publish-email-templates.yml`](../../docs/examples/publish-email-templates.yml).

## Development

```bash
pnpm test
pnpm build
```
