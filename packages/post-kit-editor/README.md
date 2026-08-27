# @singleton-sd/post-kit-editor

React admin editor component for [PostKit](../../README.md) email templates. It edits the three Git-backed source files (`template.json`, `metadata.json`, `preview.json`) in memory and hands them back to the host application to persist.

This package is currently a scaffold: it exports the public surface (`EmailTemplateEditor`, `EmailTemplateEditorProps`, `TemplateSourceFiles`) and renders an empty container. The canvas, metadata form, preview pane, and validation surfaces arrive in later issues.

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
      className="tenant-theme"
    />
  );
}
```

## Persistence is consumer-supplied

The editor never writes to disk, Git, or a network endpoint. It calls `onSave` with the edited `TemplateSourceFiles` and lets the host decide how to commit them. `onSendTest` is likewise a host-supplied hook.

## Styling

The editor ships **plain CSS classes**, no CSS-in-JS runtime and no component library. Every class is prefixed with the exported `EDITOR_CLASS_PREFIX` (`pk-editor-`), so class names are stable and safe to target from a consumer stylesheet — for example `.pk-editor-root`. The root element also accepts a `className` prop as an escape hatch for theme or layout classes.

Later issues must follow the same scheme: prefix new class names with `EDITOR_CLASS_PREFIX` and do not introduce a styling runtime.

## Component tests

Tests run on Node's built-in test runner with `tsx`, consistent with the rest of the repo — no browser-based test stack, no jsdom.

Components are rendered to static markup with `react-dom/server` and asserted against the resulting HTML string:

```tsx
import { renderToStaticMarkup } from 'react-dom/server';

const html = renderToStaticMarkup(<EmailTemplateEditor template={template} onSave={() => {}} />);
```

Specs live next to the code as `src/**/*.spec.tsx`. Later issues should keep to this approach; behaviour that genuinely requires interaction should be factored into pure functions or hooks that can be tested without a DOM.

## Development

```bash
pnpm test   # type-check + run tests
pnpm build  # emit CommonJS to dist/
pnpm lint   # covered by root eslint
```
