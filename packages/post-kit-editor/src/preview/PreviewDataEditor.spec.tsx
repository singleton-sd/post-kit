import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { EDITOR_CLASS_PREFIX } from '../email-template-editor';
import { withPreviewData } from '../working-files';
import type { TemplateSourceFiles } from '../types';
import { PreviewDataEditor } from './PreviewDataEditor';
import { setPreviewValue } from './preview-rows';

const files: TemplateSourceFiles = {
  templateJson: {
    root: {
      type: 'EmailLayout',
      data: {
        backdropColor: '#F8F8F8',
        canvasColor: '#FFFFFF',
        textColor: '#242424',
        fontFamily: 'MODERN_SANS',
        childrenIds: [],
      },
    },
  },
  metadata: {
    key: 'marketing.contact-us',
    name: 'Contact Us',
    subject: 'Hi {{name}}',
    variables: ['name', 'email'],
    schemaVersion: '1',
  },
  previewData: { name: 'Jane Doe', leftover: 'remove-me' },
};

describe('PreviewDataEditor', () => {
  it('renders declared rows (including missing) and marks extras', () => {
    const html = renderToStaticMarkup(
      <PreviewDataEditor
        declaredVariables={files.metadata.variables}
        previewData={files.previewData}
        onChange={() => {}}
      />,
    );

    assert.match(html, new RegExp(`${EDITOR_CLASS_PREFIX}preview-data`));
    assert.match(html, /data-key="name"/);
    assert.match(html, /data-key="email"/);
    assert.match(html, /data-key="leftover"/);
    assert.match(html, /data-extra="true"/);
    assert.match(html, /data-testid="pk-editor-preview-extra"/);
    assert.match(html, /value="Jane Doe"/);
    // Missing declared variable renders an empty value input.
    assert.match(html, /data-testid="pk-editor-preview-value-email"[^>]*value=""/);
  });

  it('preview-data edits reach working TemplateSourceFiles state', () => {
    const updated = setPreviewValue(files.previewData, 'email', 'jane@example.com');
    const next = withPreviewData(files, updated);
    assert.equal(next.previewData.email, 'jane@example.com');
    assert.equal(next.metadata.key, files.metadata.key);
    assert.equal(next.templateJson, files.templateJson);
  });
});
