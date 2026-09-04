import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { EDITOR_CLASS_PREFIX } from '../email-template-editor';
import { InsertionTargetProvider } from '../insertion-target';
import type { TemplateSourceMetadata } from '@singleton-sd/post-kit-types';
import { MetadataPanel } from './MetadataPanel';
import { insertAtCursor, variablePlaceholder } from './insert-at-cursor';

const metadata: TemplateSourceMetadata = {
  key: 'marketing.contact-us',
  name: 'Contact Us',
  description: 'Public contact form',
  subject: 'New message from {{name}}',
  variables: ['name'],
  schemaVersion: '1',
};

describe('MetadataPanel', () => {
  it('renders editable metadata fields bound to the working values', () => {
    const html = renderToStaticMarkup(
      <InsertionTargetProvider>
        <MetadataPanel metadata={metadata} previewData={{ name: 'Jane Doe' }} onChange={() => {}} />
      </InsertionTargetProvider>,
    );

    assert.match(html, new RegExp(`${EDITOR_CLASS_PREFIX}metadata`));
    assert.match(html, /value="marketing\.contact-us"/);
    assert.match(html, /value="Contact Us"/);
    assert.match(html, /Public contact form/);
    assert.match(html, /value="New message from \{\{name\}\}"/);
    assert.match(html, new RegExp(`${EDITOR_CLASS_PREFIX}meta-schema-version[^>]*>1<`));
    assert.match(html, /<span class="pk-editor-metadata-readonly"/);
  });

  it('shows a live non-authoritative subject preview from previewData', () => {
    const html = renderToStaticMarkup(
      <InsertionTargetProvider>
        <MetadataPanel metadata={metadata} previewData={{ name: 'Jane Doe' }} onChange={() => {}} />
      </InsertionTargetProvider>,
    );
    assert.match(html, /Preview: New message from Jane Doe/);
  });

  it('does not render a writable control for schemaVersion', () => {
    const html = renderToStaticMarkup(
      <InsertionTargetProvider>
        <MetadataPanel metadata={metadata} previewData={{ name: 'Jane' }} onChange={() => {}} />
      </InsertionTargetProvider>,
    );
    assert.doesNotMatch(html, /name="schemaVersion"/);
    assert.doesNotMatch(
      html,
      new RegExp(`<input[^>]*data-testid="${EDITOR_CLASS_PREFIX}meta-schema-version"`),
    );
  });
});

describe('subject insert-at-cursor', () => {
  it('inserts a placeholder into the subject at the caret', () => {
    const subject = 'Hello  there';
    const { value, caret } = insertAtCursor(subject, 6, 6, variablePlaceholder('name'));
    assert.equal(value, 'Hello {{name}} there');
    assert.equal(caret, 14);
  });
});
