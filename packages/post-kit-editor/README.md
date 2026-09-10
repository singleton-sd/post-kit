# @singleton-sd/post-kit-editor

React admin editor component for [PostKit](../../README.md) email templates. It
edits the three Git-backed source files (`template.json`, `metadata.json`,
`preview.json`) **in memory**. Persistence is not wired yet: `onSave` /
`onSendTest` props are part of the public contract for later issues, but this
package does not invoke them — working edits are discarded when the component
unmounts unless the host implements those callbacks (save/send-test UI lands in
a follow-up issue).

## Installation

```bash
pnpm add @singleton-sd/post-kit-editor
```

React is a **peer dependency** — the consumer application owns the React instance:

```bash
pnpm add react@^18.3.1 react-dom@^18.3.1
```

## Usage

```tsx
import { EmailTemplateEditor, type TemplateSourceFiles } from '@singleton-sd/post-kit-editor';

export function TemplateAdminPage({ template }: { template: TemplateSourceFiles }) {
  return (
    <EmailTemplateEditor
      template={template}
      availableVariables={[{ name: 'name', description: 'Recipient display name' }]}
      onSave={async (files) => {
        await fetch('/api/templates', { method: 'PUT', body: JSON.stringify(files) });
      }}
      onPreviewRendered={(html) => {
        // Optional: host can offer “open preview in new tab”
        console.log('preview bytes', html.length);
      }}
      className="tenant-theme"
    />
  );
}
```

## Persistence is consumer-supplied

The editor never writes to disk, Git, or a network endpoint. The `onSave` and
`onSendTest` props exist so consumers can rely on a stable contract, but **this
release does not call them** — there is no Save / Send-Test control yet. Edits
live only in React state (`workingFiles`) until a later issue adds that UI.

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

const html = renderToStaticMarkup(<EmailTemplateEditor template={template} onSave={() => {}} />);
```

Specs live next to the code as `src/**/*.spec.tsx`. Behaviour that needs
interaction is factored into pure functions (preview rows, `renderTemplatePreview`)
that can be tested without a DOM.

## Development

```bash
pnpm test   # type-check + run tests
pnpm build  # emit CommonJS to dist/
pnpm lint   # covered by root eslint
```
