import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { invokeConsumerAction } from './types';
import { validateSendTestRecipient } from './recipient';
import { isWorkingDirty } from './dirty';
import type { TemplateSourceFiles } from '../types';
import { TEMPLATE_SCHEMA_VERSION } from '@singleton-sd/post-kit-types';

const baseFiles: TemplateSourceFiles = {
  templateJson: {
    root: { type: 'EmailLayout', data: { childrenIds: [] } },
  },
  metadata: {
    key: 'marketing.contact-us',
    name: 'Contact Us',
    subject: 'Hi',
    variables: [],
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
  },
  previewData: {},
};

describe('validateSendTestRecipient', () => {
  it('rejects blank recipients', () => {
    assert.equal(validateSendTestRecipient(''), 'Enter a recipient email address.');
    assert.equal(validateSendTestRecipient('   '), 'Enter a recipient email address.');
  });

  it('rejects implausible shapes', () => {
    assert.match(validateSendTestRecipient('not-an-email') ?? '', /valid email/i);
  });

  it('accepts a basic email', () => {
    assert.equal(validateSendTestRecipient('user@example.com'), null);
  });
});

describe('invokeConsumerAction', () => {
  it('maps void success to ok:true', async () => {
    assert.deepEqual(await invokeConsumerAction(async () => undefined), { ok: true });
  });

  it('passes through explicit SaveResult', async () => {
    assert.deepEqual(await invokeConsumerAction(async () => ({ ok: false, message: 'nope' })), {
      ok: false,
      message: 'nope',
    });
  });

  it('converts rejected promises into ok:false without throwing', async () => {
    const result = await invokeConsumerAction(async () => {
      throw new Error('boom');
    });
    assert.deepEqual(result, { ok: false, message: 'boom' });
  });
});

describe('isWorkingDirty', () => {
  it('is false for equal snapshots', () => {
    assert.equal(isWorkingDirty(baseFiles, structuredClone(baseFiles)), false);
  });

  it('is true when metadata changes', () => {
    const next = structuredClone(baseFiles);
    next.metadata = { ...next.metadata, name: 'Changed' };
    assert.equal(isWorkingDirty(baseFiles, next), true);
  });
});
