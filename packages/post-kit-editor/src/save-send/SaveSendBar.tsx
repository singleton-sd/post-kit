import React, { useId, useState } from 'react';

import { EDITOR_CLASS_PREFIX } from '../email-template-editor';
import type { ActionFeedback } from './types';
import { validateSendTestRecipient } from './recipient';

export interface SaveSendBarProps {
  saveFeedback: ActionFeedback;
  sendFeedback: ActionFeedback;
  /** True while either action is pending — disables both controls. */
  busy: boolean;
  showSendTest: boolean;
  onSave: () => void;
  onSendTest: (recipient: string) => void;
}

/**
 * Presentational Save / Send-test toolbar. Status props are controlled by the
 * parent so SSR tests can assert pending/success/failure without effects.
 */
export function SaveSendBar({
  saveFeedback,
  sendFeedback,
  busy,
  showSendTest,
  onSave,
  onSendTest,
}: SaveSendBarProps): JSX.Element {
  const p = EDITOR_CLASS_PREFIX;
  const recipientId = useId();
  const [recipient, setRecipient] = useState('');
  const [recipientError, setRecipientError] = useState<string | null>(null);

  const handleSend = (event: React.FormEvent) => {
    event.preventDefault();
    const error = validateSendTestRecipient(recipient);
    if (error) {
      setRecipientError(error);
      return;
    }
    setRecipientError(null);
    onSendTest(recipient.trim());
  };

  return (
    <section className={`${p}save-send`} data-testid={`${p}save-send`}>
      <h2 className={`${p}save-send-heading`}>{showSendTest ? 'Save & send test' : 'Save'}</h2>
      <div className={`${p}save-send-actions`}>
        <button
          type="button"
          className={`${p}save-button`}
          data-testid={`${p}save`}
          disabled={busy}
          onClick={onSave}
        >
          {saveFeedback.status === 'pending' ? 'Saving…' : 'Save'}
        </button>
        <ActionStatusMessage
          feedback={saveFeedback}
          testId={`${p}save-status`}
          successLabel="Saved."
        />
      </div>

      {showSendTest ? (
        <form className={`${p}send-test`} data-testid={`${p}send-test`} onSubmit={handleSend}>
          <label className={`${p}send-test-label`} htmlFor={recipientId}>
            Send test to
          </label>
          <input
            id={recipientId}
            className={`${p}send-test-input`}
            type="email"
            value={recipient}
            disabled={busy}
            autoComplete="off"
            spellCheck={false}
            placeholder="you@example.com"
            data-testid={`${p}send-test-recipient`}
            onChange={(event) => {
              setRecipient(event.target.value);
              setRecipientError(null);
            }}
          />
          <button
            type="submit"
            className={`${p}send-test-button`}
            data-testid={`${p}send-test-submit`}
            disabled={busy}
          >
            {sendFeedback.status === 'pending' ? 'Sending…' : 'Send test'}
          </button>
          {recipientError ? (
            <p
              className={`${p}send-test-error`}
              data-testid={`${p}send-test-invalid`}
              role="status"
            >
              {recipientError}
            </p>
          ) : null}
          <ActionStatusMessage
            feedback={sendFeedback}
            testId={`${p}send-test-status`}
            successLabel="Test send completed."
          />
        </form>
      ) : null}
    </section>
  );
}

function ActionStatusMessage({
  feedback,
  testId,
  successLabel,
}: {
  feedback: ActionFeedback;
  testId: string;
  successLabel: string;
}): JSX.Element | null {
  const p = EDITOR_CLASS_PREFIX;
  if (feedback.status === 'idle' || feedback.status === 'pending') {
    return null;
  }
  const text =
    feedback.status === 'success'
      ? (feedback.message ?? successLabel)
      : (feedback.message ?? 'Something went wrong.');
  return (
    <p
      className={`${p}action-status ${p}action-status-${feedback.status}`}
      data-testid={testId}
      role={feedback.status === 'failure' ? 'alert' : 'status'}
    >
      {text}
    </p>
  );
}
