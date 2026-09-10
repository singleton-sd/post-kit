import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TEMPLATE_SCHEMA_VERSION } from '@singleton-sd/post-kit-types';

import type { TemplateSourceFiles } from '../types';
import {
  extractPlaceholdersFromDocument,
  extractPlaceholdersFromText,
} from './extract-placeholders';
import { hasValidationErrors, validateTemplate } from './validate';

const base: TemplateSourceFiles = {
  templateJson: {
    root: {
      type: 'EmailLayout',
      data: {
        childrenIds: ['block-text'],
      },
    },
    'block-text': {
      type: 'Text',
      data: {
        props: { text: 'Hello {{name}}' },
      },
    },
  },
  metadata: {
    key: 'marketing.contact-us',
    name: 'Contact Us',
    subject: 'Hi {{name}}',
    variables: ['name'],
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
  },
  previewData: { name: 'Jane' },
};

describe('extractPlaceholders', () => {
  it('finds placeholders in text', () => {
    assert.deepEqual(extractPlaceholdersFromText('a {{one}} b {{two}} {{one}}'), ['one', 'two']);
  });

  it('walks document string leaves', () => {
    assert.deepEqual(extractPlaceholdersFromDocument(base.templateJson), ['name']);
  });
});

describe('validateTemplate', () => {
  it('returns no issues for a valid template', () => {
    assert.deepEqual(validateTemplate(base), []);
  });

  it('reports missing-key / missing-name / missing-subject', () => {
    const files: TemplateSourceFiles = {
      ...base,
      metadata: { ...base.metadata, key: '  ', name: '', subject: '' },
      previewData: {},
    };
    const codes = validateTemplate(files).map((i) => i.code);
    assert.ok(codes.includes('missing-key'));
    assert.ok(codes.includes('missing-name'));
    assert.ok(codes.includes('missing-subject'));
  });

  it('reports invalid-key', () => {
    const files: TemplateSourceFiles = {
      ...base,
      metadata: { ...base.metadata, key: 'bad/key' },
    };
    assert.ok(validateTemplate(files).some((i) => i.code === 'invalid-key'));
  });

  it('reports undeclared-variable in subject and document', () => {
    const files: TemplateSourceFiles = {
      ...base,
      metadata: {
        ...base.metadata,
        subject: 'Hi {{name}} {{extra}}',
        variables: ['name'],
      },
      templateJson: {
        root: { type: 'EmailLayout', data: { childrenIds: ['t'] } },
        t: { type: 'Text', data: { props: { text: '{{ghost}}' } } },
      },
      previewData: { name: 'Jane' },
    };
    const issues = validateTemplate(files).filter((i) => i.code === 'undeclared-variable');
    assert.equal(issues.length, 2);
    assert.ok(issues.some((i) => i.variable === 'extra' && i.field === 'subject'));
    assert.ok(issues.some((i) => i.variable === 'ghost' && i.field === 'document'));
  });

  it('reports missing-preview-value', () => {
    const files: TemplateSourceFiles = {
      ...base,
      previewData: {},
    };
    const issue = validateTemplate(files).find((i) => i.code === 'missing-preview-value');
    assert.ok(issue);
    assert.equal(issue?.variable, 'name');
    assert.equal(issue?.severity, 'error');
  });

  it('reports unused-variable as warning', () => {
    const files: TemplateSourceFiles = {
      ...base,
      metadata: {
        ...base.metadata,
        subject: 'Static',
        variables: ['name', 'unused'],
      },
      templateJson: {
        root: { type: 'EmailLayout', data: { childrenIds: [] } },
      },
      previewData: { name: 'Jane', unused: 'x' },
    };
    const unused = validateTemplate(files).filter((i) => i.code === 'unused-variable');
    assert.ok(unused.every((i) => i.severity === 'warning'));
    assert.ok(unused.some((i) => i.variable === 'name'));
    assert.ok(unused.some((i) => i.variable === 'unused'));
  });

  it('reports extra-preview-value as warning', () => {
    const files: TemplateSourceFiles = {
      ...base,
      previewData: { name: 'Jane', bonus: 'x' },
    };
    const extra = validateTemplate(files).find((i) => i.code === 'extra-preview-value');
    assert.equal(extra?.severity, 'warning');
    assert.equal(extra?.variable, 'bonus');
  });

  it('includes render-failed from preview without recompiling', () => {
    const issues = validateTemplate(base, { renderError: 'boom' });
    assert.ok(issues.some((i) => i.code === 'render-failed' && i.message === 'boom'));
  });

  it('hasValidationErrors ignores warnings', () => {
    const files: TemplateSourceFiles = {
      ...base,
      previewData: { name: 'Jane', bonus: 'x' },
    };
    const issues = validateTemplate(files);
    assert.equal(hasValidationErrors(issues), false);
  });
});
