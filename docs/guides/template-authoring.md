# Template authoring

How a consumer team authors Git-backed PostKit email templates in its own
repository. Publishing those templates to a tenant/environment is covered in
[`template-publishing.md`](./template-publishing.md).

Everything on this page is the behaviour implemented today by
`@singleton-sd/post-kit-compiler`, `@singleton-sd/post-kit-publisher`, and the
PostKit send endpoint. Where a documented need has no implementation, it is
called out under [Known gaps](#known-gaps).

## Repository layout

Templates live in the consumer repository, one directory per template:

```text
content/email-templates/
├── marketing.contact-us/
│   ├── template.json   EmailBuilder.js document (the visual source of truth)
│   ├── metadata.json   key, name, subject, variables, schemaVersion
│   └── preview.json    sample values for every declared variable
└── transactional.welcome/
    ├── template.json
    ├── metadata.json
    └── preview.json
```

The publisher treats **every subdirectory** of the templates root as a
template, and requires all three files in each one. A subdirectory missing any
of `template.json`, `metadata.json`, or `preview.json` aborts the entire
publish run before a single template is compiled. Do not keep scratch or
partial directories under the templates root.

## Template keys

The key is `metadata.json.key`. It is validated in three places, with the same
rules each time — by the publisher before upload, by the API's template store
on load, and by the send endpoint on the request body:

- must match `/^[a-zA-Z0-9._-]+$/` (letters, digits, dot, hyphen, underscore),
- must not be empty, and must not be the bare dot-segment `.` or `..`.

Dots are the conventional namespace separator (`marketing.contact-us`), not a
directory separator — the key is always a single blob path segment.

Two further rules matter:

- **The key must match the directory it is loaded from at send time.** When the
  API loads `tenants/<tenant>/<environment>/templates/<key>/metadata.json`, it
  rejects the template with `INVALID_TEMPLATE` (HTTP 400) if the `key` field
  inside that metadata does not equal the requested template key.
- **Keys must be unique across the templates root.** If two source directories
  compile to the same key, the publish run fails and nothing is uploaded.

The source directory name is not itself validated, but the publisher uploads to
a path derived from `metadata.json.key`. **Always name the directory exactly
after the key** — otherwise the directory you edit and the blob prefix the API
reads from diverge silently.

## `metadata.json`

| Field | Required | Validated as |
| --- | --- | --- |
| `key` | yes | non-empty string; template-key rules above |
| `name` | yes | non-empty string (human-readable display name) |
| `subject` | yes | non-empty string; may contain `{{variable}}` placeholders |
| `variables` | yes | array; every element must be a string |
| `schemaVersion` | yes | non-empty string; must equal the platform's `TEMPLATE_SCHEMA_VERSION`, currently `"1"` |
| `description` | no | free-text string; carried in the type but not validated |

`variables` may be an empty array, but the field itself must be present — a
missing or non-array `variables` fails compilation with `INVALID_METADATA`.

`schemaVersion` is enforced twice: the compiler refuses to compile a mismatched
version, and the API's template store refuses to load a stored artifact whose
`schemaVersion` is not the version it was built against. A platform schema bump
therefore requires republishing, not just redeploying.

## Variables

A variable is a name declared in `metadata.variables`. It becomes a hard
requirement at send time:

1. The send handler merges tenant branding defaults first, then the caller's
   `variables` object from the request body (caller values win on conflict).
2. Every name in the stored `metadata.variables` must be present as a key in
   that merged map. Any that are not produce **HTTP 400 with error code
   `MISSING_VARIABLES`** and a message listing the missing names. Nothing is
   sent.
3. All values are strings. The request's `variables` must be a JSON object
   whose every value is a string; a non-string value is rejected with 400
   `MISSING_VARIABLES` naming the offending key. There is no coercion, no
   numbers, no nested objects.

Presence is what is checked, not usefulness — an empty string satisfies a
required variable.

### Branding defaults

Tenant branding is merged in **before** the required-variable check, so a
branding-supplied name satisfies a declared variable without the caller passing
it. The branding shape currently carries `companyName`, `logoUrl`,
`websiteUrl`, and `supportEmail`. Declaring one of those in `variables` lets a
template use it while leaving callers free to override it per send.

## Handlebars in the subject and body

`subject` and the rendered HTML body are both Handlebars templates, evaluated
at send time against the merged variable map. Handlebars is **not** the HTML
renderer — the HTML comes from the EmailBuilder.js document in `template.json`,
and the compiled HTML deliberately keeps its `{{variable}}` placeholders
un-substituted so the same artifact serves every send.

Escaping: the send handler compiles both the subject and the body with
`noEscape: false`, i.e. Handlebars' **default HTML escaping is on**. A
`{{name}}` placeholder therefore HTML-escapes its value, which is what you want
for caller-supplied content. Triple-stash `{{{name}}}` bypasses escaping and
injects raw markup — do not use it for any value that originates from a request
body.

## `template.json`

`template.json` is an EmailBuilder.js document: a JSON object keyed by block
id, which **must contain a `root` block** — the compiler renders from
`rootBlockId: 'root'` and rejects any document without it. Put `{{variable}}`
placeholders directly into block text.

## `preview.json`

`preview.json` is a flat object of sample string values. Its job is validation
and preview rendering, not documentation:

- The compiler requires a key for **every** name in `metadata.variables`;
  a missing one fails with `MISSING_PREVIEW_VARIABLE`.
- The compiler renders both the subject and the compiled HTML through
  Handlebars using this data, so a malformed template fails at compile time
  (`RENDER_FAILURE`) rather than at send time.

Sample data must be realistic in shape but must never contain real personal
data or secrets — it is committed to a Git repository. Use obviously fictional
values and `example.com` addresses. Include a long-ish value for any field that
can be long (a message body, a company name) so layout problems surface in
preview.

## Worked example: `marketing.contact-us`

`content/email-templates/marketing.contact-us/metadata.json`:

```json
{
  "key": "marketing.contact-us",
  "name": "Contact Us",
  "subject": "New message from {{name}}",
  "description": "Sent to the support inbox from the public contact form",
  "variables": ["name", "email", "message"],
  "schemaVersion": "1"
}
```

`content/email-templates/marketing.contact-us/template.json`:

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

`content/email-templates/marketing.contact-us/preview.json`:

```json
{
  "name": "Jane Doe",
  "email": "jane@example.com",
  "message": "Hello! I would like to know more about your pricing."
}
```

A send against this template must supply `name`, `email`, and `message` (unless
branding supplies one of them):

```json
{
  "template": "marketing.contact-us",
  "to": "support@example.com",
  "variables": {
    "name": "Jane Doe",
    "email": "jane@example.com",
    "message": "Hello!"
  }
}
```

## Local validation loop

Validate before opening a PR. `@singleton-sd/post-kit-compiler` exposes
`compileFromDirectory(dir)`, which performs exactly the validation the publish
pipeline performs — metadata shape, schema version, preview coverage, HTML
render, and Handlebars render:

```bash
pnpm add -D @singleton-sd/post-kit-compiler
```

```js
// scripts/validate-templates.mjs
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { compileFromDirectory } from '@singleton-sd/post-kit-compiler';

const root = 'content/email-templates';
const dirs = (await readdir(root, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

let failed = false;
for (const dir of dirs) {
  try {
    const compiled = await compileFromDirectory(join(root, dir));
    console.log(`ok   ${dir} -> ${compiled.metadata.key} ${compiled.manifest.contentHash}`);
  } catch (error) {
    failed = true;
    console.error(`FAIL ${dir}: ${error.message}`);
  }
}
process.exit(failed ? 1 : 0);
```

Run it locally and in pull-request CI. Because it uses the same compiler the
publisher uses, a green run means the publish step will not fail on
compilation. Errors carry a `code` — `INVALID_TEMPLATE_JSON`,
`INVALID_METADATA`, `MISSING_PREVIEW_VARIABLE`, or `RENDER_FAILURE`.

`compileFromDirectory` writes nothing and needs no Azure credentials, so it is
safe to run on pull requests from any branch.

## Known gaps

These are limitations of the current implementation, not of this guide:

- **The compiler ships no CLI binary.** Local validation requires the small
  script above; there is no `post-kit-compile` command.
- **The publisher has no dry-run or validate-only flag.** `post-kit-publish`
  either publishes or fails; use the compiler script to validate without
  touching storage.
- **Deleting a template directory does not delete the published blobs.** The
  publisher only uploads; removing a template from the repository leaves its
  artifacts in place, and the send endpoint will keep serving them.
