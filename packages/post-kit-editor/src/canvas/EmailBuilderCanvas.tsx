import React from 'react';

import type { EmailBuilderDocument } from '../types';
import { EDITOR_CLASS_PREFIX } from '../email-template-editor';
import { EmailBuilderMuiSurface } from '../email-builder-ui/EmailBuilderMuiSurface';

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
  return (
    <div
      id={`${EDITOR_CLASS_PREFIX}canvas`}
      className={`${EDITOR_CLASS_PREFIX}canvas`}
      data-testid={`${EDITOR_CLASS_PREFIX}canvas`}
      role="region"
      tabIndex={-1}
      aria-label="Email document canvas"
    >
      <EmailBuilderMuiSurface document={document} onChange={onChange} readOnly={readOnly} />
    </div>
  );
}
