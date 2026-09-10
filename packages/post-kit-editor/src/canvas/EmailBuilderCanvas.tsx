import React from 'react';

import type { EmailBuilderDocument } from '../types';
import { EDITOR_CLASS_PREFIX } from '../email-template-editor';
import { CanvasEditorProvider } from './editor-context';
import { EditorBlock } from './EditorBlock';
import { Reader } from '@usewaypoint/email-builder';

export interface EmailBuilderCanvasProps {
  document: EmailBuilderDocument;
  onChange: (document: EmailBuilderDocument) => void;
  readOnly?: boolean;
}

export function EmailBuilderCanvas({
  document,
  onChange,
  readOnly = false,
}: EmailBuilderCanvasProps): JSX.Element {
  if (readOnly) {
    return (
      <div
        id={`${EDITOR_CLASS_PREFIX}canvas`}
        className={`${EDITOR_CLASS_PREFIX}canvas`}
        data-testid={`${EDITOR_CLASS_PREFIX}canvas`}
        role="region"
        tabIndex={-1}
        aria-label="Email document canvas"
      >
        <Reader document={document} rootBlockId="root" />
      </div>
    );
  }

  return (
    <CanvasEditorProvider document={document} onChange={onChange}>
      <div
        id={`${EDITOR_CLASS_PREFIX}canvas`}
        className={`${EDITOR_CLASS_PREFIX}canvas`}
        data-testid={`${EDITOR_CLASS_PREFIX}canvas`}
        role="region"
        tabIndex={-1}
        aria-label="Email document canvas"
      >
        <EditorBlock id="root" />
      </div>
    </CanvasEditorProvider>
  );
}
