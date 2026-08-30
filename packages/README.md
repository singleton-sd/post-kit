# Packages

Public npm packages under `@singleton-sd/post-kit-*`.

| Package | npm name | Description |
| --- | --- | --- |
| [`post-kit-client`](./post-kit-client/README.md) | `@singleton-sd/post-kit-client` | Trusted server-side TypeScript client for the PostKit API |
| [`post-kit-compiler`](./post-kit-compiler/README.md) | `@singleton-sd/post-kit-compiler` | Template compiler — validates and compiles EmailBuilder.js source into deployable HTML |
| [`post-kit-editor`](./post-kit-editor/README.md) | `@singleton-sd/post-kit-editor` | React admin editor component for PostKit email templates |
| [`post-kit-email`](./post-kit-email/) | `@singleton-sd/post-kit-email` | Provider-agnostic transactional email (Forward Email) for PostKit |
| [`post-kit-publisher`](./post-kit-publisher/README.md) | `@singleton-sd/post-kit-publisher` | Compile and publish PostKit email templates to Azure Blob Storage |
| [`post-kit-types`](./post-kit-types/README.md) | `@singleton-sd/post-kit-types` | Shared TypeScript contracts for the PostKit platform |

All packages above are public npm packages (`"private": false` in each
`package.json`). The workspace root is private and is not published.
