import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { EDITOR_CLASS_PREFIX } from '../email-template-editor';
import type { TemplateSourceFiles } from '../types';
import { PreviewErrorBanner, PreviewFrame, wrapPreviewHtmlWithCsp } from './preview-frame';
import { PreviewPane } from './PreviewPane';
import { renderTemplatePreview } from './render-template-preview';

const validFiles: TemplateSourceFiles = {
  templateJson: {
    root: {
      type: 'EmailLayout',
      data: {
        backdropColor: '#F8F8F8',
        canvasColor: '#FFFFFF',
        textColor: '#242424',
        fontFamily: 'MODERN_SANS',
        childrenIds: ['block-text'],
      },
    },
    'block-text': {
      type: 'Text',
      data: {
        style: {
          fontWeight: 'normal',
          padding: { top: 16, bottom: 16, right: 24, left: 24 },
        },
        props: {
          text: 'Hello {{name}}',
        },
      },
    },
  },
  metadata: {
    key: 'marketing.contact-us',
    name: 'Contact Us',
    subject: 'Hi {{name}}',
    variables: ['name'],
    schemaVersion: '1',
  },
  previewData: { name: 'Jane Doe' },
};

const brokenFiles: TemplateSourceFiles = {
  ...validFiles,
  templateJson: {
    document: { type: 'EmailLayout' },
  } as unknown as TemplateSourceFiles['templateJson'],
};

describe('renderTemplatePreview', () => {
  it('returns substituted HTML for a valid template', async () => {
    const result = await renderTemplatePreview(validFiles);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.match(result.html, /Hello Jane Doe/);
      assert.doesNotMatch(result.html, /\{\{name\}\}/);
    }
  });

  it('returns the compiler error message on render failure', async () => {
    const result = await renderTemplatePreview(brokenFiles);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /Failed to render template HTML|root/i);
    }
  });

  it('returns a missing-variable error without throwing', async () => {
    const result = await renderTemplatePreview({
      ...validFiles,
      previewData: {},
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /missing variable.*"name"/i);
    }
  });
});

describe('wrapPreviewHtmlWithCsp', () => {
  it('injects a restrictive CSP meta tag into fragment HTML', () => {
    const wrapped = wrapPreviewHtmlWithCsp('<p>Hello</p>');
    assert.match(wrapped, /http-equiv="Content-Security-Policy"/i);
    assert.match(wrapped, /connect-src 'none'/);
    assert.match(wrapped, /img-src data:/);
    assert.match(wrapped, /<p>Hello<\/p>/);
  });

  it('injects into an existing head when present', () => {
    const wrapped = wrapPreviewHtmlWithCsp(
      '<!DOCTYPE html><html><head><title>t</title></head><body>x</body></html>',
    );
    assert.match(wrapped, /<head><meta http-equiv="Content-Security-Policy"/i);
  });
});

describe('PreviewPane presentational surfaces', () => {
  it('renders PreviewErrorBanner with alert role and message', () => {
    const html = renderToStaticMarkup(
      <PreviewErrorBanner message="Failed to render template HTML: bad document" />,
    );
    assert.match(html, /Failed to render template HTML: bad document/);
    assert.match(html, /role="alert"/);
    assert.match(html, new RegExp(`${EDITOR_CLASS_PREFIX}preview-error`));
  });

  it('renders PreviewFrame with sandbox, csp, and CSP-wrapped srcDoc', async () => {
    const rendered = await renderTemplatePreview(validFiles);
    assert.equal(rendered.ok, true);
    if (!rendered.ok) return;

    const html = renderToStaticMarkup(<PreviewFrame html={rendered.html} />);
    assert.match(html, /sandbox=""/);
    assert.match(html, /\bcsp="/);
    assert.match(html, /connect-src &#x27;none&#x27;|connect-src 'none'/);
    assert.match(html, /srcdoc="/i);
    assert.match(html, /Content-Security-Policy/);
    assert.match(html, /Hello Jane Doe/);
    assert.match(html, new RegExp(`${EDITOR_CLASS_PREFIX}preview-frame`));
  });

  it('mounts PreviewPane chrome (effects do not run under SSR)', () => {
    const html = renderToStaticMarkup(<PreviewPane files={validFiles} debounceMs={0} />);
    assert.match(html, new RegExp(`${EDITOR_CLASS_PREFIX}preview-pane`));
    assert.match(html, /Rendering preview/);
  });
});
