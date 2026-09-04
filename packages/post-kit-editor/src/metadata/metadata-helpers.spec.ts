import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  TEMPLATE_KEY_CHARSET_MESSAGE,
  TEMPLATE_KEY_RESERVED_MESSAGE,
  isAcceptableTemplateKeyInput,
  templateKeyInputError,
} from './template-key';
import { insertAtCursor, variablePlaceholder } from './insert-at-cursor';
import { previewSubject } from './subject-preview';

describe('templateKeyInputError', () => {
  it('accepts publisher-safe keys', () => {
    assert.equal(templateKeyInputError('marketing.contact-us'), null);
    assert.equal(templateKeyInputError('a_b-c.1'), null);
    assert.equal(templateKeyInputError(''), null);
  });

  it('rejects characters outside the blob-path charset', () => {
    assert.equal(templateKeyInputError('a/b'), TEMPLATE_KEY_CHARSET_MESSAGE);
    assert.equal(templateKeyInputError('has space'), TEMPLATE_KEY_CHARSET_MESSAGE);
    assert.equal(templateKeyInputError('café'), TEMPLATE_KEY_CHARSET_MESSAGE);
    assert.equal(isAcceptableTemplateKeyInput('a/b'), false);
  });

  it('rejects reserved "." and ".." keys', () => {
    assert.equal(templateKeyInputError('.'), TEMPLATE_KEY_RESERVED_MESSAGE);
    assert.equal(templateKeyInputError('..'), TEMPLATE_KEY_RESERVED_MESSAGE);
  });
});

describe('insertAtCursor', () => {
  it('inserts at the caret without replacing', () => {
    assert.deepEqual(insertAtCursor('Hello  world', 6, 6, '{{name}}'), {
      value: 'Hello {{name}} world',
      caret: 14,
    });
  });

  it('replaces the selected range', () => {
    assert.deepEqual(insertAtCursor('Hello NAME!', 6, 10, '{{name}}'), {
      value: 'Hello {{name}}!',
      caret: 14,
    });
  });

  it('formats variable placeholders', () => {
    assert.equal(variablePlaceholder('branding.companyName'), '{{branding.companyName}}');
  });
});

describe('previewSubject', () => {
  it('substitutes known preview values and leaves unknowns intact', () => {
    assert.equal(
      previewSubject('Hi {{name}} from {{branding.companyName}}', {
        name: 'Jane',
      }),
      'Hi Jane from {{branding.companyName}}',
    );
  });
});
