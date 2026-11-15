import type { Meta, StoryObj } from '@storybook/react';
import React, { useState } from 'react';

import { EmailTemplateAdmin, EmailTemplateEditor } from '../../../src';
import {
  delaySave,
  emptyTemplate,
  mockSave,
  mockSaveFailure,
  sampleAvailableVariables,
  welcomeTemplate,
} from '../../fixtures';

const meta = {
  title: 'Admin/Email Builder/States',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const Loading: Story = {
  render: () => <EmailTemplateAdmin templates={[]} loading onSave={mockSave} />,
};

export const LoadError: Story = {
  render: () => (
    <EmailTemplateAdmin
      templates={[]}
      loadError="Synthetic catalog fetch failure (Storybook)."
      onSave={mockSave}
    />
  ),
};

export const Saving: Story = {
  parameters: {
    docs: {
      description: {
        story: 'Click Save to see the pending “Saving…” state (1.2s delayed mock).',
      },
    },
  },
  render: () => (
    <EmailTemplateEditor
      template={welcomeTemplate}
      availableVariables={sampleAvailableVariables}
      onSave={delaySave(1200)}
    />
  ),
};

export const Saved: Story = {
  parameters: {
    docs: {
      description: {
        story: 'Immediate successful save feedback via mockSave — click Save.',
      },
    },
  },
  render: () => (
    <EmailTemplateEditor
      template={welcomeTemplate}
      availableVariables={sampleAvailableVariables}
      onSave={mockSave}
    />
  ),
};

export const SaveError: Story = {
  parameters: {
    docs: {
      description: {
        story: 'Click Save to surface synthetic failure feedback.',
      },
    },
  },
  render: () => (
    <EmailTemplateEditor
      template={welcomeTemplate}
      availableVariables={sampleAvailableVariables}
      onSave={mockSaveFailure}
    />
  ),
};

export const InvalidDocument: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Admin loadError shell — used when the host cannot parse template source (loadTemplateSource would throw before mount).',
      },
    },
  },
  render: () => (
    <EmailTemplateAdmin
      templates={[]}
      loadError="template.json: must be an EmailBuilder document object with a root block"
      onSave={mockSave}
    />
  ),
};

export const ExistingTemplate: Story = {
  render: () => (
    <EmailTemplateAdmin
      templates={[welcomeTemplate, emptyTemplate]}
      availableVariables={sampleAvailableVariables}
      onSave={mockSave}
    />
  ),
};

function UnsavedChangesDemo(): JSX.Element {
  const [dirty, setDirty] = useState(false);
  return (
    <div>
      <p data-testid="pk-story-dirty-flag" style={{ padding: 8, margin: 0 }}>
        Dirty: {dirty ? 'yes' : 'no'} — edit metadata or canvas to mark unsaved.
      </p>
      <EmailTemplateEditor
        template={welcomeTemplate}
        availableVariables={sampleAvailableVariables}
        onSave={mockSave}
        onDirtyChange={setDirty}
      />
    </div>
  );
}

export const UnsavedChanges: Story = {
  parameters: {
    docs: {
      description: {
        story: 'Edit any field; the host `onDirtyChange` flag above flips to yes until Save.',
      },
    },
  },
  render: () => <UnsavedChangesDemo />,
};
