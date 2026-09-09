import React, { useEffect, useRef, useState } from 'react';

import { EDITOR_CLASS_PREFIX } from '../email-template-editor';
import type { TemplateSourceFiles } from '../types';
import {
  PREVIEW_DEBOUNCE_MS,
  renderTemplatePreview,
  type PreviewRenderResult,
} from './render-template-preview';

export interface PreviewPaneProps {
  /** Current working template source (document + metadata + preview data). */
  files: TemplateSourceFiles;
  /**
   * Called with the rendered HTML whenever a preview render succeeds.
   * Consumers can use this for “open in new tab” without re-compiling.
   */
  onPreviewRendered?: (html: string) => void;
  /** Debounce window for re-renders (ms). Defaults to {@link PREVIEW_DEBOUNCE_MS}. */
  debounceMs?: number;
}

/**
 * Debounced, sandboxed HTML preview of the working template.
 *
 * Uses `@singleton-sd/post-kit-compiler` `renderPreview` so the pane matches
 * the publish/send rendering path. Render failures show the compiler message
 * without unmounting the rest of the editor.
 */
export function PreviewPane({
  files,
  onPreviewRendered,
  debounceMs = PREVIEW_DEBOUNCE_MS,
}: PreviewPaneProps): JSX.Element {
  const p = EDITOR_CLASS_PREFIX;
  const [result, setResult] = useState<PreviewRenderResult | null>(null);
  const [pending, setPending] = useState(true);
  const onPreviewRenderedRef = useRef(onPreviewRendered);
  onPreviewRenderedRef.current = onPreviewRendered;
  const requestIdRef = useRef(0);

  useEffect(() => {
    setPending(true);
    const requestId = ++requestIdRef.current;
    const timer = setTimeout(() => {
      void (async () => {
        const next = await renderTemplatePreview(files);
        // Ignore stale responses when a newer edit superseded this request.
        if (requestId !== requestIdRef.current) {
          return;
        }
        setResult(next);
        setPending(false);
        if (next.ok) {
          onPreviewRenderedRef.current?.(next.html);
        }
      })();
    }, debounceMs);

    return () => {
      clearTimeout(timer);
      // Invalidate in-flight renders from this effect instance.
      requestIdRef.current += 1;
    };
  }, [files, debounceMs]);

  return (
    <section className={`${p}preview-pane`} data-testid={`${p}preview-pane`}>
      <h2 className={`${p}preview-pane-heading`}>Preview</h2>
      {result === null ? (
        <p className={`${p}preview-pane-status`} data-testid={`${p}preview-pending`}>
          Rendering preview…
        </p>
      ) : null}
      {pending && result !== null ? (
        <p className={`${p}preview-pane-status`} data-testid={`${p}preview-updating`}>
          Updating preview…
        </p>
      ) : null}
      {result && !result.ok ? (
        <p className={`${p}preview-pane-error`} data-testid={`${p}preview-error`} role="alert">
          {result.error}
        </p>
      ) : null}
      {result?.ok ? (
        <iframe
          className={`${p}preview-frame`}
          title="Email preview"
          sandbox=""
          srcDoc={result.html}
          data-testid={`${p}preview-frame`}
        />
      ) : null}
    </section>
  );
}
