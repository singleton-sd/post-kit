import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { EDITOR_CLASS_PREFIX } from '../email-template-editor';
import { ValidationSummary } from './ValidationSummary';
import type { ValidationIssue } from './validate';

const p = EDITOR_CLASS_PREFIX;

describe('ValidationSummary', () => {
  it('renders nothing when there are no issues', () => {
    const html = renderToStaticMarkup(<ValidationSummary issues={[]} />);
    assert.equal(html, '');
  });

  it('groups errors and warnings in a live region with focus links', () => {
    const issues: ValidationIssue[] = [
      {
        severity: 'error',
        code: 'missing-name',
        message: 'Template name is required.',
        field: 'metadata',
      },
      {
        severity: 'warning',
        code: 'unused-variable',
        message: 'Declared variable "x" is not used.',
        field: 'metadata',
        variable: 'x',
      },
    ];
    const html = renderToStaticMarkup(<ValidationSummary issues={issues} />);
    assert.match(html, new RegExp(`data-testid="${p}validation-live"`));
    assert.match(html, /aria-live="polite"/);
    assert.match(html, new RegExp(`data-testid="${p}validation-errors"`));
    assert.match(html, new RegExp(`data-testid="${p}validation-warnings"`));
    assert.match(html, /data-focus-target="pk-editor-meta-name"/);
    assert.match(html, /missing-name/);
  });
});
