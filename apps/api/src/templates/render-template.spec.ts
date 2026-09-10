import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TEMPLATE_SCHEMA_VERSION, type CompiledTemplate } from '@singleton-sd/post-kit-types';
import { PostKitErrorCode } from '@singleton-sd/post-kit-types';
import {
  mergeTemplateVariables,
  renderCompiledTemplate,
  validateAndRenderTemplate,
  validateRequiredVariables,
} from './render-template';

const COMPILED: CompiledTemplate = {
  templateHtml: '<p>{{greeting}} {{name}}</p>',
  metadata: {
    key: 't.sample',
    name: 'Sample',
    subject: 'Hello {{name}}',
    variables: ['name', 'greeting'],
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
  },
  manifest: {
    key: 't.sample',
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    compiledAt: '',
    sourceCommit: '',
    variables: ['name', 'greeting'],
    contentHash: '',
  },
};

describe('render-template', () => {
  it('mergeTemplateVariables lets caller values win over branding', () => {
    assert.deepEqual(mergeTemplateVariables({ name: 'Brand', greeting: 'Hi' }, { name: 'Ada' }), {
      name: 'Ada',
      greeting: 'Hi',
    });
  });

  it('validateRequiredVariables reports missing own properties', () => {
    const result = validateRequiredVariables(COMPILED, { name: 'Ada' });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, PostKitErrorCode.MISSING_VARIABLES);
      assert.deepEqual(result.missing, ['greeting']);
    }
  });

  it('validateAndRenderTemplate renders subject and html when complete', () => {
    const result = validateAndRenderTemplate(COMPILED, { greeting: 'Hi' }, { name: 'Ada' });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.rendered.subject, 'Hello Ada');
      assert.equal(result.rendered.html, '<p>Hi Ada</p>');
    }
  });

  it('renderCompiledTemplate escapes HTML by default', () => {
    const rendered = renderCompiledTemplate(COMPILED, {
      name: '<script>',
      greeting: 'Hi',
    });
    assert.equal(rendered.subject, 'Hello &lt;script&gt;');
    assert.match(rendered.html, /&lt;script&gt;/);
  });
});
