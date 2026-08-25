# @singleton-sd/post-kit-publisher

Compile Git-backed PostKit email templates and publish runtime artifacts to Azure Blob Storage for `apps/api` TemplateStore.

## Install

```bash
pnpm add @singleton-sd/post-kit-publisher
```

## CLI

```bash
post-kit-publish \
  --templates ./content/email-templates \
  --tenant inkads \
  --environment production \
  --storage-account ssdpostkitstprodae \
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
  tenant: 'inkads',
  environment: 'production',
  storageAccount: 'ssdpostkitstprodae',
  container: 'templates',
  commit: process.env.GITHUB_SHA,
});
```

## GitHub Actions (OIDC) example

```yaml
name: Publish email templates
on:
  push:
    paths:
      - 'content/email-templates/**'
jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - uses: azure/login@v2
        with:
          client-id: ${{ vars.AZURE_CLIENT_ID }}
          tenant-id: ${{ vars.AZURE_TENANT_ID }}
          subscription-id: ${{ vars.AZURE_SUBSCRIPTION_ID }}
      - run: >
          pnpm exec post-kit-publish
          --templates ./content/email-templates
          --tenant inkads
          --environment production
          --storage-account ssdpostkitstprodae
          --container templates
          --commit ${{ github.sha }}
```

## Development

```bash
pnpm test
pnpm build
```
