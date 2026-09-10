# Package installation and versioning

How consumers install, pin, and upgrade the published `@singleton-sd/post-kit-*`
packages, and how those versions relate to the API and template schema.

Published versions live on [npmjs under `@singleton-sd`](https://www.npmjs.com/org/singleton-sd).
Package-level READMEs under [`packages/`](../../packages/README.md) cover APIs
in depth; this guide is the cross-package install and semver map.

## Published packages

| Package | Role | Typical direct install? |
| --- | --- | --- |
| [`@singleton-sd/post-kit-client`](../../packages/post-kit-client/README.md) | Trusted **server-side** SDK for `POST /emails/send` | **Yes** — any backend that sends mail through PostKit |
| [`@singleton-sd/post-kit-types`](../../packages/post-kit-types/README.md) | Shared TypeScript contracts (`SendRequest` / `SendResponse`, template metadata, errors) | **Often** — for typing against the HTTP contract; also a dependency of client/compiler/publisher/editor |
| [`@singleton-sd/post-kit-publisher`](../../packages/post-kit-publisher/README.md) | Compile + publish templates to Azure Blob (`post-kit-publish` CLI) | **Yes** — in CI / release pipelines of consumer template repos |
| [`@singleton-sd/post-kit-compiler`](../../packages/post-kit-compiler/README.md) | Validate/compile EmailBuilder source; `preview` entry for browser-safe preview | **Sometimes** — CI validation or custom tooling; publisher depends on it; editor uses the preview entry |
| [`@singleton-sd/post-kit-editor`](../../packages/post-kit-editor/README.md) | React admin editor for the three Git-backed template source files | **Yes** — admin UIs that edit templates in-browser |
| [`@singleton-sd/post-kit-email`](../../packages/post-kit-email/README.md) | Provider-agnostic transactional email (Forward Email) used by `apps/api` | **Rarely** — intended for PostKit runtime / provision tooling, not typical send consumers |

Do **not** put long-lived PostKit credentials (or `@singleton-sd/post-kit-client`)
in browser bundles. Public forms POST to your own trusted server; see
[`guides/api-quickstart.md`](./api-quickstart.md) and
[`guides/public-forms.md`](./public-forms.md).

## Install

Supported **Node.js**: `>=20.18.1` (from each package `engines` field). CI for
this repository uses Node 24; consumers should stay on a current Node 20 LTS or
newer.

**Module format:** published builds are **CommonJS** (`tsc` `module: commonjs`,
no `"type": "module"` in package manifests). They expose `main` / `types` and
conditional `exports` with `types` + `default` pointing at `dist/`. They work
from both CJS and typical ESM/bundler consumers via Node’s interop.

```bash
# Trusted send SDK (+ types pull transitively)
pnpm add @singleton-sd/post-kit-client

# Explicit types (optional if you already depend on client)
pnpm add @singleton-sd/post-kit-types

# Template publish pipeline
pnpm add -D @singleton-sd/post-kit-publisher

# Admin editor (React is a peer dependency)
pnpm add @singleton-sd/post-kit-editor
pnpm add react@^18.3.1 react-dom@^18.3.1
```

npm / yarn equivalents:

```bash
npm install @singleton-sd/post-kit-client
yarn add @singleton-sd/post-kit-client
```

Prefer **exact or caret pins** in lockfiles (`pnpm-lock.yaml` / `package-lock.json`).
Do not leave production apps on floating `*` / `latest` for these packages.

## Version compatibility

### Client, types, and the deployed API

- `@singleton-sd/post-kit-client` and `@singleton-sd/post-kit-types` encode the
  public send contract (`SendRequest`, `SendResponse`, `PostKitErrorCode`).
- Keep **client and types on the same minor line** when you install both
  explicitly (workspace releases often bump them together).
- After upgrading either package, confirm your app still matches the **deployed**
  PostKit API environment you call (error codes, required headers, body shape).
  A newer client against an older API can surface unexpected `PostKitErrorCode`
  values or validation failures.

### Template `schemaVersion` vs compiler / publisher

- Template source and compiled manifests carry `schemaVersion` (currently
  `TEMPLATE_SCHEMA_VERSION = '1'` in `@singleton-sd/post-kit-types`).
- `@singleton-sd/post-kit-compiler` and `@singleton-sd/post-kit-publisher` must
  understand that schema. When PostKit introduces a new schema major, bump
  compiler/publisher (and editor if you author in-app) **before** committing
  templates that declare the new version.
- Prefer aligning publisher/compiler versions with the PostKit release that
  your target Blob / API environment expects.

### Editor

- `@singleton-sd/post-kit-editor` depends on types + compiler preview. Upgrade
  editor together with types when template contracts change.

## Semantic versioning policy

Releases follow [conventional commits](https://www.conventionalcommits.org/)
via the path-aware release script (see
[`operations/releasing.md`](../operations/releasing.md)):

| Commit signal | Bump |
| --- | --- |
| `fix:` / `perf:` | patch |
| `feat:` | minor |
| `BREAKING CHANGE` / `type!:` | major |

**Breaking change (major)** for a public package includes, without limitation:

- Removing or renaming a public export
- Changing required fields or meaning of `SendRequest` / `SendResponse` /
  `PostKitErrorResponse` / `PostKitErrorCode`
- Changing CLI flags or exit semantics of `post-kit-publish` in incompatible ways
- Raising the minimum Node `engines` requirement in a way that drops a supported LTS

**Stability of the send contract:** `SendRequest` / `SendResponse` are marked as
a public API surface in `post-kit-types`. Additive optional fields may ship as
**minor**; incompatible field removals or type changes are **major**. Prefer
switching on `PostKitErrorCode` rather than HTTP status or message text.

Pre-1.0 (`0.x`) packages may still ship meaningful breaks on minor bumps when
necessary; treat `0.x` minors as potentially disruptive and read the release
notes before upgrading production.

## Upgrade guidance

1. Read the **GitHub Release** for the package tag
   (`@singleton-sd/<package>@<version>`) — notes link to npmjs and summarize
   the conventional-changelog body.
2. Diff your lockfile / `package.json` pins; run install and your app’s test suite.
3. After a **client** upgrade: re-verify a real or staging `send()` (auth,
   template key, variables, error handling / retries).
4. After a **publisher / compiler** upgrade: re-publish (or dry-run compile) a
   representative template set; confirm `schemaVersion` and blob layout still
   match [`guides/template-publishing.md`](./template-publishing.md).
5. After an **editor** upgrade: smoke-test Save / Send-test against your host
   callbacks and preview rendering.

Maintainer release mechanics (OIDC publish, what agents must not do) are in
[`operations/releasing.md`](../operations/releasing.md). Secrets policy:
[`pr-pipelines.md`](../pr-pipelines.md) (no tokens in GitHub Secrets; Key Vault
for app secrets).
