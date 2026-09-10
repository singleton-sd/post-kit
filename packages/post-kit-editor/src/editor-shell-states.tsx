import React from 'react';

import { EDITOR_CLASS_PREFIX } from './email-template-editor';

export interface EditorLoadingStateProps {
  /** Optional status text while the consumer loads template files. */
  message?: string;
}

/** Non-interactive loading shell for the editor surface. */
export function EditorLoadingState({
  message = 'Loading template…',
}: EditorLoadingStateProps): JSX.Element {
  const p = EDITOR_CLASS_PREFIX;
  return (
    <div
      className={`${p}loading`}
      data-testid={`${p}loading`}
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      <p className={`${p}loading-message`}>{message}</p>
    </div>
  );
}

export interface EditorLoadErrorStateProps {
  message: string;
}

/** Non-interactive error shell when the consumer failed to load template files. */
export function EditorLoadErrorState({ message }: EditorLoadErrorStateProps): JSX.Element {
  const p = EDITOR_CLASS_PREFIX;
  return (
    <div className={`${p}load-error`} data-testid={`${p}load-error`} role="alert">
      <h2 className={`${p}load-error-heading`}>Could not load template</h2>
      <p className={`${p}load-error-message`}>{message}</p>
    </div>
  );
}
