import React from 'react';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { EmailTemplateEditor, EDITOR_CLASS_PREFIX } from './index';
import type { EmailTemplateEditorProps } from './index';
import type { TemplateSourceFiles } from './types';
import { EmailBuilderCanvas } from './canvas/EmailBuilderCanvas';
import type { EmailBuilderDocument } from './types';

const template: TemplateSourceFiles = {
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

  it('renders the EmailBuilder canvas inside the root container', () => {
    const html = renderToStaticMarkup(<EmailTemplateEditor {...baseProps} />);
    assert.match(html, new RegExp(`class="[^"]*${EDITOR_CLASS_PREFIX}canvas`));
    assert.match(html, /Hello \{\{name\}\}/);
  });

  it('renders the metadata panel and variable catalogue beside the canvas', () => {
    const html = renderToStaticMarkup(<EmailTemplateEditor {...baseProps} />);
    assert.match(html, new RegExp(`${EDITOR_CLASS_PREFIX}metadata`));
    assert.match(html, new RegExp(`${EDITOR_CLASS_PREFIX}variables`));
    assert.match(html, /value="marketing\.contact-us"/);
    assert.match(html, /value="Contact Us"/);
    assert.match(html, /Preview: New message from Jane Doe/);
    assert.match(html, /\{\{name\}\}/);
  });

  it('lists availableVariables when the consumer supplies them', () => {
    const html = renderToStaticMarkup(
      <EmailTemplateEditor
        {...baseProps}
        availableVariables={[{ name: 'resetUrl', label: 'Reset URL' }]}
      />,
    );
    assert.match(html, /Reset URL/);
    assert.match(html, /\{\{resetUrl\}\}/);
  });

  it('does not render save or send-test chrome yet', () => {
    const html = renderToStaticMarkup(<EmailTemplateEditor {...baseProps} />);
    assert.doesNotMatch(html, /send test/i);
    assert.doesNotMatch(html, /data-testid="[^"]*save/);
  });
});

describe('EmailBuilderCanvas', () => {
  it('renders the document via Reader in readOnly mode', () => {
    const document: EmailBuilderDocument = template.templateJson;
    const html = renderToStaticMarkup(
      <EmailBuilderCanvas document={document} onChange={() => {}} readOnly />,
    );
    assert.match(html, /Hello \{\{name\}\}/);
  });
});
