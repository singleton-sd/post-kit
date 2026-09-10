import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TEMPLATE_SCHEMA_VERSION } from '@singleton-sd/post-kit-types';

import type { TemplateSourceFiles } from '../types';
import {
  finishSaveAction,
  finishSendTestAction,
  startSaveAction,
  startSendTestAction,
} from './actions';
import { isWorkingDirty } from './dirty';
import { validateSendTestRecipient } from './recipient';
import { invokeConsumerAction } from './types';

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

  it('treats equivalent objects with reordered keys as clean', () => {
    const reordered: TemplateSourceFiles = {
      templateJson: {
        root: { data: { childrenIds: [] }, type: 'EmailLayout' },
      },
      metadata: {
        schemaVersion: TEMPLATE_SCHEMA_VERSION,
        variables: [],
        subject: 'Hi',
        name: 'Contact Us',
        key: 'marketing.contact-us',
      },
      previewData: {},
    };
    assert.equal(isWorkingDirty(baseFiles, reordered), false);
  });
});

describe('startSaveAction / finishSaveAction', () => {
  it('noops when busy or validation-blocked', () => {
    assert.equal(
      startSaveAction({ busy: true, validationBlocked: false, files: baseFiles }).status,
      'noop',
    );
    assert.equal(
      startSaveAction({ busy: false, validationBlocked: true, files: baseFiles }).status,
      'noop',
    );
  });

  it('invokes onSave with serialized payload and honors stale generation', async () => {
    const started = startSaveAction({
      busy: false,
      validationBlocked: false,
      files: baseFiles,
    });
    assert.equal(started.status, 'ready');
    if (started.status !== 'ready') {
      throw new Error('expected ready');
    }

    const args: unknown[] = [];
    const success = await finishSaveAction({
      payload: started.payload,
      isGenerationCurrent: () => true,
      onSave: (serialized, files) => {
        args.push(serialized, files);
        return { ok: true, message: 'saved' };
      },
    });
    assert.equal(success.status, 'success');
    if (success.status === 'success') {
      assert.equal(success.message, 'saved');
      assert.equal(args[1], baseFiles);
    }

    const stale = await finishSaveAction({
      payload: started.payload,
      isGenerationCurrent: () => false,
      onSave: () => ({ ok: true }),
    });
    assert.equal(stale.status, 'stale');
  });
});

describe('startSendTestAction / finishSendTestAction', () => {
  it('noops when send-test is disabled', () => {
    assert.equal(
      startSendTestAction({
        busy: false,
        validationBlocked: false,
        sendTestEnabled: false,
        files: baseFiles,
        recipient: 'a@b.co',
      }).status,
      'noop',
    );
  });

  it('rejects bad recipients and passes trimmed recipient to onSendTest', async () => {
    assert.equal(
      startSendTestAction({
        busy: false,
        validationBlocked: false,
        sendTestEnabled: true,
        files: baseFiles,
        recipient: 'bad',
      }).status,
      'recipient-error',
    );

    const started = startSendTestAction({
      busy: false,
      validationBlocked: false,
      sendTestEnabled: true,
      files: baseFiles,
      recipient: '  a@b.co  ',
    });
    assert.equal(started.status, 'ready');
    if (started.status !== 'ready') {
      throw new Error('expected ready');
    }
    assert.equal(started.recipient, 'a@b.co');

    let seenRecipient = '';
    const result = await finishSendTestAction({
      payload: started.payload,
      recipient: started.recipient,
      isGenerationCurrent: () => true,
      onSendTest: (_s, _f, recipient) => {
        seenRecipient = recipient;
      },
    });
    assert.equal(result.status, 'success');
    assert.equal(seenRecipient, 'a@b.co');
  });
});
