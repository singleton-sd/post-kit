import React from 'react';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { EmailTemplateEditor, EDITOR_CLASS_PREFIX } from './index';
import type { EmailTemplateEditorProps } from './index';
import type { TemplateSourceFiles } from './types';

const template: TemplateSourceFiles = {
  templateJson: { root: { type: 'EmailLayout', data: {} } },
  metadata: {
    key: 'marketing.contact-us',
    name: 'Contact Us',
    subject: 'New message from {{name}}',
    variables: ['name'],
    schemaVersion: '1',
  },
  previewData: { name: 'Jane Doe' },
};

const baseProps: EmailTemplateEditorProps = {
  template,
  onSave: () => {},
};

describe('EmailTemplateEditor', () => {
  it('renders without throwing', () => {
    const html = renderToStaticMarkup(<EmailTemplateEditor {...baseProps} />);
    assert.ok(html.length > 0);
  });

  it('renders a root container carrying the prefixed root class', () => {
    const html = renderToStaticMarkup(<EmailTemplateEditor {...baseProps} />);
    assert.match(html, new RegExp(`class="[^"]*${EDITOR_CLASS_PREFIX}root`));
  });

  it('appends the consumer className to the root container', () => {
    const html = renderToStaticMarkup(
      <EmailTemplateEditor {...baseProps} className="tenant-theme" />,
    );
    assert.match(html, /class="[^"]*tenant-theme/);
  });

  it('does not render editor chrome yet', () => {
    const html = renderToStaticMarkup(<EmailTemplateEditor {...baseProps} />);
    assert.doesNotMatch(html, /<button/);
  });
});
