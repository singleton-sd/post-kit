# @singleton-sd/post-kit-editor

Full-page React admin for [PostKit](../../README.md) email templates
(`EmailTemplateAdmin`), plus lower-level surfaces for advanced hosts. Edits the
three Git-backed source files (`template.json`, `metadata.json`,
`preview.json`) **in memory**, with Save and optional Send-test controls that
call **consumer-supplied** callbacks. The package never writes to disk, Git, or
the network, and never accepts API keys or other credentials as props.

The canvas is a port of the official EmailBuilder.js MUI sample (inspector +
samples). See [`src/email-builder-ui/NOTICE.md`](./src/email-builder-ui/NOTICE.md).

## Installation

```bash
pnpm add @singleton-sd/post-kit-editor
```

React is a **peer dependency** — the consumer application owns the React instance:

```bash
pnpm add react@^18.3.1 react-dom@^18.3.1
```

MUI / Emotion ship as package dependencies. You do not need to wrap
`ThemeProvider` yourself.

## Usage (recommended)

```tsx
import {
  EmailTemplateAdmin,
  type TemplateSourceFiles,
  type SerializedTemplateSource,
} from '@singleton-sd/post-kit-editor';

export function TemplateAdminPage({ templates }: { templates: TemplateSourceFiles[] }) {
  return (
    <EmailTemplateAdmin
      templates={templates}
      onSave={async (serialized: SerializedTemplateSource, files: TemplateSourceFiles) => {
        const res = await fetch('/api/templates', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serialized, key: files.metadata.key }),
        });
        if (!res.ok) {
          return { ok: false, message: 'Save failed.' };
        }
      }}
      onSendTest={async (_serialized, files, recipient) => {
        const res = await fetch('/api/email-templates/send-test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            templateKey: files.metadata.key,
            to: recipient,
            variables: files.previewData,
          }),
        });
        if (!res.ok) {
          return { ok: false, message: 'Test send failed.' };
        }
      }}
    />
  );
}
```

Guide: [`docs/guides/editor-integration.md`](../../docs/guides/editor-integration.md).
Thin host example: [`examples/admin-editor/`](../../examples/admin-editor/).
Single-template advanced surface: `EmailTemplateEditor` (see
[`examples/minimal/`](./examples/minimal/)).

## Props

### `EmailTemplateAdmin`

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `templates` | `TemplateSourceFiles[]` | yes | Catalog (at least one). |
| `onSave` | `(serialized, files) => SaveResult \| void \| Promise<…>` | yes | Persist working files. |
| `onSendTest` | `(serialized, files, recipient) => SendTestResult \| void \| Promise<…>` | no | When set, shows Send-test chrome. |
| `availableVariables` | `TemplateVariable[]` | no | Catalogue labels; defaults to metadata names. |
| `loading` / `loadError` / `className` / dirty & validation callbacks | — | no | Same semantics as `EmailTemplateEditor`. |

### `EmailTemplateEditor` (advanced)

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `template` | `TemplateSourceFiles` | yes | Seeded working triple (`templateJson`, `metadata`, `previewData`). |
| `onSave` | `(serialized, files) => SaveResult \| void \| Promise<…>` | yes | Persist working files. Receives serialized Git strings **and** structured files. |
| `onSendTest` | `(serialized, files, recipient) => SendTestResult \| void \| Promise<…>` | no | When set, shows Send-test chrome. Must route through the consumer’s trusted server. |
| `availableVariables` | `TemplateVariable[]` | no | Catalogue entries offered to the editing user. |
| `onDirtyChange` | `(dirty: boolean) => void` | no | Fires when working state diverges from the seeded `template` (resets after successful save). |
| `onValidationChange` | `(issues: ValidationIssue[]) => void` | no | Current validation issues whenever they change. |
| `onPreviewRendered` | `(html: string) => void` | no | Successful preview HTML (e.g. open-in-new-tab without recompiling). |
| `loading` | `boolean` | no | Non-interactive loading shell while the host fetches files. |
| `loadError` | `string` | no | Non-interactive error shell with the host’s message. |
| `className` | `string` | no | Extra class on the root element. |

Also exported: `loadTemplateSource`, `serializeTemplateSource`,
`validateTemplate`, `hasValidationErrors`, `EDITOR_CLASS_PREFIX`,
`ADMIN_CLASS_PREFIX`, and related types.

## What this package does not do

- **No persistence** — it never writes to disk, Git, or object storage. `onSave`
  is the only way contents leave the editor.
- **No sending** — it never calls PostKit or any mail transport. `onSendTest`
  (when provided) is a consumer callback only.
- **No credentials** — there are no API-key / token props. Secrets stay on the
  consumer’s trusted server (Key Vault / env), never in browser bundles.
- **No publish pipeline** — compilation and content hashing belong to
  `@singleton-sd/post-kit-compiler` in CI or server tooling.

## Persistence is consumer-supplied

Save serializes the working state with `serializeTemplateSource()` and passes
both the `SerializedTemplateSource` strings and the structured
`TemplateSourceFiles` to `onSave`. The editor shows pending / success / failure
feedback and re-enables the control in every outcome. Rejected promises become
failure messages (no unhandled rejections).

Send-test chrome appears **only** when `onSendTest` is provided. The editor
validates a non-empty, plausible recipient address, then invokes the callback
with the same serialized payload plus the recipient. Test delivery must go
through the consumer's trusted server (typically `@singleton-sd/post-kit-client`
server-side).

Optional `onDirtyChange` fires when working state diverges from the seeded
`template` prop and resets after a successful save.

## Validation and accessibility

`validateTemplate(files)` (also exported) checks required metadata, key charset,
undeclared / unused variables, preview coverage, and optional `render-failed`
from the preview pane (passed through so the compiler is not invoked twice).
Error-severity issues disable Save and Send-test; warnings never block.

Optional props:

- `onValidationChange` — current `ValidationIssue[]` whenever it changes
- `loading` — non-interactive loading shell while the host fetches files
- `loadError` — non-interactive error shell with the host’s message

Inline field errors use `aria-describedby`. The validation summary is an
`aria-live` region; each entry focuses the responsible control.

## Preview data (synthetic only)

`preview.json` is edited in the preview-data panel and used to render the
sandboxed preview pane via `@singleton-sd/post-kit-compiler/preview`
`renderPreview` (same EmailBuilder + Handlebars path as publish). Those sample
values are **committed to the consumer repository** with the template source.

**Never put real personal data, customer addresses, or secrets in preview
data.** Keep values synthetic (e.g. `Jane Doe`, `jane@example.com`).

The preview pane shows compiler errors inline when render fails and leaves the
canvas / metadata editable. Re-renders are debounced while typing. Optional
`onPreviewRendered` receives the HTML string on each successful render.

Browser note: preview imports `@singleton-sd/post-kit-compiler/preview`, which
has no Node built-ins. Full `compile()` (content hashing + filesystem) remains
on the package root for CI and publish tooling. The preview iframe applies a
restrictive CSP (`connect-src 'none'`, `img-src data:` only) so template HTML
cannot trigger arbitrary network fetches from the admin page.

## Styling

The editor ships **plain CSS classes**, no CSS-in-JS runtime and no component
library. Every class is prefixed with the exported `EDITOR_CLASS_PREFIX`
(`pk-editor-`), so class names are stable and safe to target from a consumer
stylesheet — for example `.pk-editor-root`. The root element also accepts a
`className` prop as an escape hatch for theme or layout classes.

## Component tests

Tests run on Node's built-in test runner with `tsx`, consistent with the rest of
the repo — no browser-based test stack, no jsdom.

Components are rendered to static markup with `react-dom/server` and asserted
against the resulting HTML string:

```tsx
import { renderToStaticMarkup } from 'react-dom/server';

const html = renderToStaticMarkup(
  <EmailTemplateEditor template={template} onSave={() => {}} />,
);
```

Specs live next to the code as `src/**/*.spec.tsx`. Behaviour that needs
interaction is factored into pure functions (preview rows, save/send helpers)
that can be tested without a DOM. The end-to-end suite (`src/e2e.spec.tsx`)
drives load → edit → validate → save / send-test through those helpers plus SSR
markup.

## Storybook (local visual exploration)

Package-local Storybook (Vite + React) for clicking through the canvas,
metadata, variable catalogue, preview pane, and save/send-test chrome with
**synthetic fixtures only**. It is not a substitute for
[`examples/minimal/`](./examples/minimal/) (canonical consumer sample) or for
the SSR unit tests above.

```bash
# from the monorepo root
pnpm --filter @singleton-sd/post-kit-editor storybook
```

Opens on http://localhost:6006. Stories live under `stories/` with config in
`.storybook/`. Both are outside the published `files` / `dist` surface (along
with `examples/`). Prefer **Admin / EmailTemplateAdmin** for full-page review;
`EmailTemplateEditor` stories use Storybook-only layout CSS so the PostKit
sidebar sits beside the canvas (the published package still ships class names
without a required stylesheet).

Most stories use the public API (`EmailTemplateEditor`, `EmailBuilderCanvas`).
Isolated panel stories import private modules from `src/` and document that
they are **dev-only** — do not treat those paths as a supported public API.

## Visual review (Playwright + Storybook)

CI job **`visual-review`** screenshots three Storybook iframe stories against
committed PNGs in [`visual-baselines/`](./visual-baselines/). Capture always
exits 0; `test:visual:gate` fails when the manifest has `changed` / `new`
unless `VISUAL_ACCEPTED=1` (or the PR has label `visual-accepted`).

Stories (desktop 1440×900):

- `admin-emailtemplateadmin--full-admin`
- `editor-emailbuildercanvas--editable`
- `editor-emailtemplateeditor--full-editor`

```bash
# from the monorepo root
pnpm --filter @singleton-sd/post-kit-editor playwright:install
pnpm --filter @singleton-sd/post-kit-editor build-storybook
pnpm --filter @singleton-sd/post-kit-editor test:visual
pnpm --filter @singleton-sd/post-kit-editor test:visual:gate
```

Output lands in `test-results/visual/` (gitignored): `pr/`, `base/`, `diff/`,
`manifest.json`, and `index.html`. Open the HTML report locally to inspect
diffs.

### Updating baselines

After intentional UI changes, prefer **CI Linux** screenshots (download the
`editor-visual` artifact `pr/*.png`) so local/WSL font rendering does not
drift the gate:

```bash
cp /path/to/editor-visual/pr/*.png \
  packages/post-kit-editor/visual-baselines/
```

Or from a local Linux capture after `build-storybook` + `test:visual`:

```bash
cp packages/post-kit-editor/test-results/visual/pr/*.png \
  packages/post-kit-editor/visual-baselines/
pnpm --filter @singleton-sd/post-kit-editor test:visual
pnpm --filter @singleton-sd/post-kit-editor test:visual:gate
```

Commit the updated PNGs under `visual-baselines/`.

### Accepting diffs without updating baselines

On a PR, add the GitHub label **`visual-accepted`**. That alone clears the
`visual-review` check (no rebuild). Prefer committing new baselines when the
change is intentional and should become the new reference.

## Development

```bash
pnpm test       # type-check + run tests
pnpm build      # emit CommonJS to dist/
pnpm lint       # covered by root eslint
pnpm storybook  # local Storybook (from this package, or via --filter above)
```

`examples/` and Storybook (`stories/`, `.storybook/`) are documentation /
dev-only: they are not listed in the package `files` allowlist for publish and
are outside `src/`, so they are neither published to npm nor emitted into
`dist/`.