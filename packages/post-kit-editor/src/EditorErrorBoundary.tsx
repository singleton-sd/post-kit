import React, { Component, type ErrorInfo, type ReactNode } from 'react';

import { EDITOR_CLASS_PREFIX } from './email-template-editor';

export interface EditorErrorBoundaryProps {
  children: ReactNode;
}

interface EditorErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches render/parse failures in the editor tree so the host app stays mounted.
 * Retry clears the error and re-renders children.
 */
export class EditorErrorBoundary extends Component<
  EditorErrorBoundaryProps,
  EditorErrorBoundaryState
> {
  state: EditorErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): EditorErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep host logging optional — avoid noisy console in SSR tests.
    if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'test') {
      console.error('post-kit-editor render failure', error, info.componentStack);
    }
  }

  private handleRetry = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const p = EDITOR_CLASS_PREFIX;
    if (this.state.error) {
      return (
        <div className={`${p}fatal-error`} data-testid={`${p}fatal-error`} role="alert">
          <h2 className={`${p}fatal-error-heading`}>Editor failed to render</h2>
          <p className={`${p}fatal-error-message`}>{this.state.error.message}</p>
          <button
            type="button"
            className={`${p}fatal-error-retry`}
            data-testid={`${p}fatal-error-retry`}
            onClick={this.handleRetry}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
