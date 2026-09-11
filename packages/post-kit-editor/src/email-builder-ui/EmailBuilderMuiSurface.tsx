import React, { useEffect, useRef } from 'react';

import { CssBaseline, ThemeProvider } from '@mui/material';
import { Reader } from '@usewaypoint/email-builder';

import type { EmailBuilderDocument } from '../types';
import App from './App';
import { resetDocument, subscribeDocument } from './documents/editor/EditorContext';
import type { TEditorConfiguration } from './documents/editor/core';
import theme from './theme';

export interface EmailBuilderMuiSurfaceProps {
  document: EmailBuilderDocument;
  onChange: (document: EmailBuilderDocument) => void;
  readOnly?: boolean;
}

function asEditorDocument(document: EmailBuilderDocument): TEditorConfiguration {
  return document as TEditorConfiguration;
}

/**
 * Controlled MUI EmailBuilder.js canvas surface for PostKit.
 * Syncs the Zustand editor store with parent `document` / `onChange`.
 *
 * The first controlled document is applied synchronously during render so SSR /
 * `renderToStaticMarkup` paints the correct tree; later prop updates sync in
 * an effect to avoid updating subscribers while React is rendering.
 */
export function EmailBuilderMuiSurface({
  document,
  onChange,
  readOnly = false,
}: EmailBuilderMuiSurfaceProps): JSX.Element {
  const lastEmittedJsonRef = useRef<string | null>(null);
  const hasAppliedInitialRef = useRef(false);
  const incomingJson = JSON.stringify(document);

  if (!readOnly && !hasAppliedInitialRef.current) {
    hasAppliedInitialRef.current = true;
    lastEmittedJsonRef.current = incomingJson;
    resetDocument(asEditorDocument(document));
  }

  useEffect(() => {
    if (readOnly) {
      return;
    }
    if (incomingJson === lastEmittedJsonRef.current) {
      return;
    }
    lastEmittedJsonRef.current = incomingJson;
    resetDocument(asEditorDocument(document));
  }, [document, incomingJson, readOnly]);

  useEffect(() => {
    if (readOnly) {
      return;
    }
    return subscribeDocument((next) => {
      const json = JSON.stringify(next);
      if (json === lastEmittedJsonRef.current) {
        return;
      }
      lastEmittedJsonRef.current = json;
      onChange(next as EmailBuilderDocument);
    });
  }, [onChange, readOnly]);

  if (readOnly) {
    return (
      <div data-testid="pk-editor-eb-mui-surface">
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <Reader document={document} rootBlockId="root" />
        </ThemeProvider>
      </div>
    );
  }

  return (
    <div data-testid="pk-editor-eb-mui-surface">
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <App />
      </ThemeProvider>
    </div>
  );
}
