// `tsx` (the test runner's loader) compiles JSX with the classic runtime, so
// React must be in scope even though `tsc` is configured for `react-jsx`.
import React from 'react';

import type { TemplateSourceFiles, TemplateVariable } from './types';

/**
 * Prefix for every CSS class the editor emits.
 *
 * The editor ships plain, stable class names rather than a CSS-in-JS runtime or
 * a component library, so consumers can style it with their own stylesheet.
 */
export const EDITOR_CLASS_PREFIX = 'pk-editor-';

export interface EmailTemplateEditorProps {
  /** Template source files loaded from the consumer repository. */
  template: TemplateSourceFiles;
  /** Variable catalogue shown to the editing user. */
  availableVariables?: TemplateVariable[];
  onSave: (files: TemplateSourceFiles) => Promise<void> | void;
  onSendTest?: (files: TemplateSourceFiles, recipient: string) => Promise<void> | void;
  className?: string;
}

/**
 * Placeholder editor surface.
 *
 * Renders the root container only — the canvas, metadata form, preview pane and
 * validation surfaces arrive in later issues. Persistence is consumer-supplied
 * via `onSave`.
 */
export function EmailTemplateEditor({ className }: EmailTemplateEditorProps): JSX.Element {
  const rootClassName = [`${EDITOR_CLASS_PREFIX}root`, className].filter(Boolean).join(' ');

  return <div className={rootClassName} data-testid={`${EDITOR_CLASS_PREFIX}root`} />;
}
