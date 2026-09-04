import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { EDITOR_CLASS_PREFIX } from '../email-template-editor';
import { InsertionTargetProvider } from '../insertion-target';
import type { TemplateSourceFiles, TemplateVariable } from '../types';
import { withMetadata, withMetadataVariables } from '../working-files';
import { copyTextToClipboard } from './clipboard';
import { resolveCatalogueVariables } from './resolve-catalogue';
import { VariableCatalogue } from './VariableCatalogue';

const template: TemplateSourceFiles = {
  templateJson: {
    root: {
      type: 'EmailLayout',
      data: { childrenIds: [] },
    },
  },
  metadata: {
    key: 'marketing.contact-us',
    name: 'Contact Us',
    subject: 'New message from {{name}}',
    variables: ['name', 'email'],
    schemaVersion: '1',
  },
  previewData: { name: 'Jane Doe', email: 'jane@example.com' },
};

describe('resolveCatalogueVariables', () => {
  it('prefers availableVariables when supplied', () => {
    const available: TemplateVariable[] = [
      { name: 'firstName', label: 'First name' },
      { name: 'resetUrl', label: 'Reset URL' },
    ];
    assert.deepEqual(resolveCatalogueVariables(available, ['name']), available);
  });

  it('falls back to metadata.variables when availableVariables is omitted', () => {
    assert.deepEqual(resolveCatalogueVariables(undefined, ['name', 'email']), [
      { name: 'name' },
      { name: 'email' },
    ]);
  });

  it('uses an empty availableVariables list rather than falling back', () => {
    assert.deepEqual(resolveCatalogueVariables([], ['name']), []);
  });
});

describe('VariableCatalogue', () => {
  it('renders metadata.variables when availableVariables is omitted', () => {
    const html = renderToStaticMarkup(
      <InsertionTargetProvider>
        <VariableCatalogue
          metadataVariables={template.metadata.variables}
          onMetadataVariablesChange={() => {}}
        />
      </InsertionTargetProvider>,
    );
    assert.match(html, /\{\{name\}\}/);
    assert.match(html, /\{\{email\}\}/);
    assert.match(html, new RegExp(`${EDITOR_CLASS_PREFIX}variables-insert-name`));
  });

  it('renders availableVariables labels when supplied', () => {
    const html = renderToStaticMarkup(
      <InsertionTargetProvider>
        <VariableCatalogue
          availableVariables={[
            { name: 'firstName', label: 'First name' },
            { name: 'resetUrl', label: 'Reset URL' },
          ]}
          metadataVariables={['name']}
          onMetadataVariablesChange={() => {}}
        />
      </InsertionTargetProvider>,
    );
    assert.match(html, /First name/);
    assert.match(html, /Reset URL/);
    assert.match(html, /\{\{firstName\}\}/);
    assert.doesNotMatch(html, /data-testid="pk-editor-variables-insert-name"/);
  });

  it('disables insert when no insertion target is focused', () => {
    const html = renderToStaticMarkup(
      <InsertionTargetProvider>
        <VariableCatalogue metadataVariables={['name']} onMetadataVariablesChange={() => {}} />
      </InsertionTargetProvider>,
    );
    assert.match(html, /disabled/);
    assert.match(html, /Focus the subject field/);
  });
});

describe('withMetadataVariables', () => {
  it('updates declared variables without mutating the document', () => {
    const next = withMetadataVariables(template, ['name']);
    assert.deepEqual(next.metadata.variables, ['name']);
    assert.equal(next.templateJson, template.templateJson);
    assert.equal(next.metadata.subject, template.metadata.subject);
  });
});

describe('withMetadata', () => {
  it('propagates metadata field edits into TemplateSourceFiles', () => {
    const next = withMetadata(template, {
      ...template.metadata,
      name: 'Renamed',
      key: 'marketing.renamed',
      description: 'Updated',
      subject: 'Subject {{name}}',
    });
    assert.equal(next.metadata.name, 'Renamed');
    assert.equal(next.metadata.key, 'marketing.renamed');
    assert.equal(next.metadata.description, 'Updated');
    assert.equal(next.metadata.subject, 'Subject {{name}}');
    assert.equal(next.templateJson, template.templateJson);
  });
});

describe('copyTextToClipboard', () => {
  it('resolves ok:false without throwing when clipboard is unavailable', async () => {
    const result = await copyTextToClipboard('{{name}}');
    assert.equal(result.ok, false);
  });
});
