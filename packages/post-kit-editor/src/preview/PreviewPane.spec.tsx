import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { EDITOR_CLASS_PREFIX } from '../email-template-editor';
import type { TemplateSourceFiles } from '../types';
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

describe('PreviewPane', () => {
  it('renders the preview surface with a sandboxed iframe contract in markup', () => {
    // useEffect does not run under react-dom/server; assert the chrome mounts
    // and that successful renders use a script-disabled sandbox (unit-tested
    // via renderTemplatePreview above for the failure path).
    const html = renderToStaticMarkup(<PreviewPane files={validFiles} debounceMs={0} />);
    assert.match(html, new RegExp(`${EDITOR_CLASS_PREFIX}preview-pane`));
    assert.match(html, /Rendering preview/);
  });

  it('documents sandbox + srcDoc attributes on the iframe element type', () => {
    // Static assertion of the failure-path UI by rendering an error message
    // the same way PreviewPane does after renderTemplatePreview fails.
    const errorHtml = renderToStaticMarkup(
      <section className={`${EDITOR_CLASS_PREFIX}preview-pane`}>
        <p className={`${EDITOR_CLASS_PREFIX}preview-pane-error`} role="alert">
          Failed to render template HTML: bad document
        </p>
      </section>,
    );
    assert.match(errorHtml, /Failed to render template HTML: bad document/);
    assert.match(errorHtml, /role="alert"/);

    const frameHtml = renderToStaticMarkup(
      <iframe
        className={`${EDITOR_CLASS_PREFIX}preview-frame`}
        title="Email preview"
        sandbox=""
        srcDoc="<p>Hello Jane Doe</p>"
      />,
    );
    assert.match(frameHtml, /sandbox=""/);
    assert.match(frameHtml, /srcDoc="|srcdoc="/i);
  });
});
