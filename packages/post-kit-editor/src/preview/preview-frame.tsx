/**
 * Preview iframe document helpers — CSP wrapping and presentational pieces
 * that PreviewPane mounts after a render settles.
 *
 * Kept free of hooks so they can be asserted with `renderToStaticMarkup`
 * (package convention: no jsdom / browser test runner).
 */
import React from 'react';

import { EDITOR_CLASS_PREFIX } from '../email-template-editor';

/**
 * Restrictive CSP for preview HTML.
 *
 * Blocks scripts, connections, forms, and plugins. Allows inline styles (email
 * HTML) and `data:` images/fonts only — remote https images do not load in the
 * admin preview by design.
 */
export const PREVIEW_DOCUMENT_CSP =
  "default-src 'none'; script-src 'none'; connect-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'";

/**
 * Wrap rendered email HTML so the srcdoc document enforces {@link PREVIEW_DOCUMENT_CSP}.
 */
export function wrapPreviewHtmlWithCsp(html: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_DOCUMENT_CSP}">`;
  const trimmed = html.trim();
  if (/^<!DOCTYPE/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) {
    if (/<head[\s>]/i.test(trimmed)) {
      return trimmed.replace(/<head([^>]*)>/i, `<head$1>${meta}`);
    }
    return trimmed.replace(/<html([^>]*)>/i, `<html$1><head>${meta}</head>`);
  }
  return `<!DOCTYPE html><html><head>${meta}</head><body>${html}</body></html>`;
}

export function PreviewErrorBanner({ message }: { message: string }): JSX.Element {
  const p = EDITOR_CLASS_PREFIX;
  return (
    <p className={`${p}preview-pane-error`} data-testid={`${p}preview-error`} role="alert">
      {message}
    </p>
  );
}

export function PreviewFrame({ html }: { html: string }): JSX.Element {
  const p = EDITOR_CLASS_PREFIX;
  const srcDoc = wrapPreviewHtmlWithCsp(html);
  // Non-standard `csp` attribute (CSP Embedded Enforcement) — not in React's iframe typings.
  return React.createElement('iframe', {
    className: `${p}preview-frame`,
    title: 'Email preview',
    sandbox: '',
    srcDoc,
    'data-testid': `${p}preview-frame`,
    csp: PREVIEW_DOCUMENT_CSP,
  } as React.IframeHTMLAttributes<HTMLIFrameElement> & {
    csp: string;
    'data-testid': string;
  });
}
