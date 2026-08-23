# @singleton-sd/post-kit-types

Shared TypeScript contracts for the [PostKit](https://github.com/singleton-sd/post-kit) platform.

This package has **no runtime dependencies** — it is a pure types layer. All exports are TypeScript interfaces, type aliases, and enums.

## Install

```bash
pnpm add @singleton-sd/post-kit-types
```

## Contracts

### Template source (Git-backed source files)

| Export | Description |
|--------|-------------|
| `TemplateSourceMetadata` | Contents of `metadata.json` — key, name, subject, variables list, schema version |
| `TemplatePreviewData` | Contents of `preview.json` — sample variable values for preview and CI validation |
| `CompiledTemplate` | Runtime artifact produced by `post-kit-compiler` — HTML + metadata + manifest |
| `TemplateManifest` | Compilation provenance — commit SHA, timestamp, content hash |
| `TEMPLATE_SCHEMA_VERSION` | Current schema version string (`'1'`) |

### API send (`POST /emails/send`)

| Export | Description |
|--------|-------------|
| `SendRequest` | Request body — `template`, `to`, `variables` |
| `SendResponse` | Success response — `id`, `status: 'sent'` |
| `PostKitErrorResponse` | Error response — `error`, `code`, `correlationId` |
| `PostKitErrorCode` | Enum of stable machine-readable error codes |

### Tenant

| Export | Description |
|--------|-------------|
| `TenantContext` | Resolved tenant identity — `tenantId`, `environment` |
| `TenantEnvironment` | `'development' \| 'staging' \| 'production'` |
| `TenantBranding` | Optional branding defaults merged into template variables |
| `TemplateVariables` | `Record<string, string>` — the fully merged variable map |

## Error codes

```ts
import { PostKitErrorCode } from '@singleton-sd/post-kit-types';

switch (error.code) {
  case PostKitErrorCode.TEMPLATE_NOT_FOUND:  // 404 — template key not in storage
  case PostKitErrorCode.MISSING_VARIABLES:   // 422 — required variable absent
  case PostKitErrorCode.UNAUTHENTICATED:     // 401 — no valid credential
  case PostKitErrorCode.UNAUTHORIZED:        // 403 — credential maps to no tenant
  case PostKitErrorCode.INVALID_TEMPLATE:    // 422 — template artifact malformed
  case PostKitErrorCode.INVALID_RECIPIENT:   // 422 — recipient address invalid
  case PostKitErrorCode.PROVIDER_FAILURE:    // 502 — email provider error
  case PostKitErrorCode.STORAGE_FAILURE:     // 502 — blob storage error
}
```

## Usage example

```ts
import type { SendRequest, SendResponse, TenantContext } from '@singleton-sd/post-kit-types';

const request: SendRequest = {
  template: 'marketing.contact-us',
  to: 'hello@example.com',
  variables: {
    name: 'Jane Doe',
    email: 'jane@example.com',
    message: 'I would like to know more',
  },
};
```

## Consumers

| Package / app | Uses |
|---------------|------|
| `apps/api` | `SendRequest`, `SendResponse`, `PostKitErrorResponse`, `PostKitErrorCode`, `TenantContext`, `TenantBranding`, `TemplateVariables`, `CompiledTemplate` |
| `post-kit-compiler` | `TemplateSourceMetadata`, `TemplatePreviewData`, `CompiledTemplate`, `TemplateManifest` |
| `post-kit-publisher` | `CompiledTemplate`, `TenantContext` |
| `post-kit-client` | `SendRequest`, `SendResponse`, `PostKitErrorResponse`, `PostKitErrorCode` |
| `post-kit-editor` | `TemplateSourceMetadata`, `TemplatePreviewData`, `TenantBranding` |

## Contributing

This package is part of the [PostKit monorepo](https://github.com/singleton-sd/post-kit). See [AGENTS.md](../../AGENTS.md) for the engineering workflow.

All exported names are a **public API surface** — treat them as stable. Breaking changes require a major version bump.
