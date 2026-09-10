import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { EDITOR_CLASS_PREFIX } from '../email-template-editor';
import { SaveSendBar } from './SaveSendBar';

const p = EDITOR_CLASS_PREFIX;

describe('SaveSendBar', () => {
  it('always renders Save and hides Send-test without showSendTest', () => {
    const html = renderToStaticMarkup(
      <SaveSendBar
        saveFeedback={{ status: 'idle' }}
        sendFeedback={{ status: 'idle' }}
        busy={false}
        showSendTest={false}
        onSave={() => undefined}
        onSendTest={() => undefined}
      />,
    );
    assert.match(html, new RegExp(`data-testid="${p}save"`));
    assert.doesNotMatch(html, /send test/i);
    assert.doesNotMatch(html, new RegExp(`data-testid="${p}send-test"`));
  });

  it('renders Send-test when showSendTest is true', () => {
    const html = renderToStaticMarkup(
      <SaveSendBar
        saveFeedback={{ status: 'idle' }}
        sendFeedback={{ status: 'idle' }}
        busy={false}
        showSendTest={true}
        onSave={() => undefined}
        onSendTest={() => undefined}
      />,
    );
    assert.match(html, new RegExp(`data-testid="${p}send-test"`));
    assert.match(html, /Send test/);
  });

  it('disables controls and shows Saving label while busy/pending', () => {
    const html = renderToStaticMarkup(
      <SaveSendBar
        saveFeedback={{ status: 'pending' }}
        sendFeedback={{ status: 'idle' }}
        busy={true}
        showSendTest={true}
        onSave={() => undefined}
        onSendTest={() => undefined}
      />,
    );
    assert.match(html, /Saving…/);
    assert.match(html, /disabled/);
  });

  it('surfaces save failure with alert role', () => {
    const html = renderToStaticMarkup(
      <SaveSendBar
        saveFeedback={{ status: 'failure', message: 'disk full' }}
        sendFeedback={{ status: 'idle' }}
        busy={false}
        showSendTest={false}
        onSave={() => undefined}
        onSendTest={() => undefined}
      />,
    );
    assert.match(html, /disk full/);
    assert.match(html, /role="alert"/);
  });
});
