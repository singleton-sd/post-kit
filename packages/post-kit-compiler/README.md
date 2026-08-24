# @singleton-sd/post-kit-compiler

Template compiler for [PostKit](../../README.md). Reads Git-backed email template source files (`template.json`, `metadata.json`, `preview.json`), validates them, and produces a compiled `CompiledTemplate` artifact for use by `post-kit-publisher` and `apps/api`.

## HTML renderer and variable engine

HTML is produced by [`@usewaypoint/email-builder`](https://www.npmjs.com/package/@usewaypoint/email-builder) `renderToStaticMarkup` (EmailBuilder.js JSON → email HTML).

Subject lines and `{{variable}}` substitution in that HTML use [Handlebars](https://handlebarsjs.com/) `^4.7.8` (the version declared in this package). Handlebars is **not** the HTML renderer.

Until send-time substitution, compiled `templateHtml` keeps Handlebars placeholders. `compile()` still renders preview.json through Handlebars to fail fast on invalid templates.

## Installation

```bash
pnpm add @singleton-sd/post-kit-compiler
```

## API

```ts
import { compile, compileFromDirectory, validateSource, CompilerError } from '@singleton-sd/post-kit-compiler';
```

### `compile(source, options?)`

Validates and compiles a `TemplateSource` object into a `CompiledTemplate`.

```ts
const result = await compile({
  templateJson: { document: { type: 'EmailLayout', data: {} } },
  metadata: {
    key: 'marketing.contact-us',
    name: 'Contact Us',
    subject: 'New message from {{name}}',
    variables: ['name', 'email', 'message'],
    schemaVersion: '1',
  },
  previewData: { name: 'Jane Doe', email: 'jane@example.com', message: 'Hello!' },
});

console.log(result.manifest.contentHash); // SHA-256 hex
```

### `compileFromDirectory(dir, options?)`

Reads `template.json`, `metadata.json`, and `preview.json` from `dir` and delegates to `compile()`.

```ts
const result = await compileFromDirectory('./content/email-templates/marketing.contact-us');
```

### `validateSource(source)`

Dry-run validation — returns `{ ok: true }` or `{ ok: false; errors: string[] }`. Does not throw.

```ts
const validation = validateSource(source);
if (!validation.ok) {
  console.error(validation.errors);
}
```

### `CompilerError`

Thrown by `compile()` and `compileFromDirectory()` on validation or render failures. Has a `code` property:

| Code | Meaning |
|---|---|
| `INVALID_TEMPLATE_JSON` | `template.json` is missing or not valid JSON |
| `INVALID_METADATA` | `metadata.json` or `preview.json` is missing, not valid JSON, or fails schema validation |
| `MISSING_PREVIEW_VARIABLE` | A variable declared in `metadata.variables` is absent from `previewData` |
| `RENDER_FAILURE` | HTML or subject template rendering failed |

## Development

```bash
pnpm test   # type-check + run tests
pnpm build  # emit CommonJS to dist/
pnpm lint   # covered by root eslint
```
