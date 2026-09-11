/**
 * Private/dev-only: `SaveSendBar` is not a public package export. Stories
 * import it from `src/` with mocked callbacks — no network I/O.
 */
import type { Meta, StoryObj } from '@storybook/react';
import React, { useState } from 'react';

import { SaveSendBar } from '../src/save-send/SaveSendBar';
import type { ActionFeedback } from '../src/save-send/types';

function SaveSendDemo({
  initialSave = { status: 'idle' } as ActionFeedback,
  initialSend = { status: 'idle' } as ActionFeedback,
  validationBlocked = false,
  showSendTest = true,
}: {
  initialSave?: ActionFeedback;
  initialSend?: ActionFeedback;
  validationBlocked?: boolean;
  showSendTest?: boolean;
}): JSX.Element {
  const [saveFeedback, setSaveFeedback] = useState<ActionFeedback>(initialSave);
  const [sendFeedback, setSendFeedback] = useState<ActionFeedback>(initialSend);
  const [busy, setBusy] = useState(false);

  const onSave = () => {
    setBusy(true);
    setSaveFeedback({ status: 'pending' });
    window.setTimeout(() => {
      setSaveFeedback({ status: 'success', message: 'Mock save (no persistence).' });
      setBusy(false);
    }, 400);
  };

  const onSendTest = (recipient: string) => {
    setBusy(true);
    setSendFeedback({ status: 'pending' });
    window.setTimeout(() => {
      setSendFeedback({
        status: 'success',
        message: `Mock send-test to ${recipient} (no network).`,
      });
      setBusy(false);
    }, 400);
  };

  return (
    <div className="pk-story-shell">
      <SaveSendBar
        saveFeedback={saveFeedback}
        sendFeedback={sendFeedback}
        busy={busy}
        validationBlocked={validationBlocked}
        validationBlockedReason="Fix validation errors before saving or sending a test."
        showSendTest={showSendTest}
        onSave={onSave}
        onSendTest={onSendTest}
      />
    </div>
  );
}

const meta = {
  title: 'Editor/SaveSendBar',
  parameters: {
    docs: {
      description: {
        component:
          'Save / send-test controls with mocked in-memory callbacks (private module). Never calls PostKit or the network.',
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const IdleWithSendTest: Story = {
  render: () => <SaveSendDemo />,
};

export const SaveOnly: Story = {
  render: () => <SaveSendDemo showSendTest={false} />,
};

export const ValidationBlocked: Story = {
  render: () => <SaveSendDemo validationBlocked />,
};

export const FailureFeedback: Story = {
  render: () => (
    <SaveSendDemo
      initialSave={{ status: 'failure', message: 'Synthetic save failure.' }}
      initialSend={{ status: 'failure', message: 'Synthetic send-test failure.' }}
    />
  ),
};
