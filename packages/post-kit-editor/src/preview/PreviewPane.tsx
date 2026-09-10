import React, { useEffect, useRef, useState } from 'react';

import { EDITOR_CLASS_PREFIX } from '../email-template-editor';
import type { TemplateSourceFiles } from '../types';
import { PreviewErrorBanner, PreviewFrame } from './preview-frame';
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
  /**
   * Notifies the parent when preview render succeeds or fails so validation
   * can surface `render-failed` without compiling twice.
   */
  onPreviewResultChange?: (result: PreviewRenderResult | null) => void;
  /** Debounce window for re-renders (ms). Defaults to {@link PREVIEW_DEBOUNCE_MS}. */
  debounceMs?: number;
}

/**
 * Debounced, sandboxed HTML preview of the working template.
 *
 * Uses `@singleton-sd/post-kit-compiler/preview` `renderPreview` so the pane
 * matches the publish/send rendering path without pulling Node built-ins into
 * the editor bundle. Render failures show the compiler message without
 * unmounting the rest of the editor.
 */
export function PreviewPane({
  files,
  onPreviewRendered,
  onPreviewResultChange,
  debounceMs = PREVIEW_DEBOUNCE_MS,
}: PreviewPaneProps): JSX.Element {
  const p = EDITOR_CLASS_PREFIX;
  const [result, setResult] = useState<PreviewRenderResult | null>(null);
  const [pending, setPending] = useState(true);
  const onPreviewRenderedRef = useRef(onPreviewRendered);
  onPreviewRenderedRef.current = onPreviewRendered;
  const onPreviewResultChangeRef = useRef(onPreviewResultChange);
  onPreviewResultChangeRef.current = onPreviewResultChange;
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
        onPreviewResultChangeRef.current?.(next);
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
      {result && !result.ok ? <PreviewErrorBanner message={result.error} /> : null}
      {result?.ok ? <PreviewFrame html={result.html} /> : null}
    </section>
  );
}
