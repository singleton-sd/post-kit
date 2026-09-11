import type { Meta, StoryObj } from '@storybook/react';
import React, { useState } from 'react';

import { EmailBuilderCanvas, type EmailBuilderDocument } from '../src';
import { nestedBlocksTemplate } from './fixtures';

const meta = {
  title: 'Editor/EmailBuilderCanvas',
  component: EmailBuilderCanvas,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        story:
          'Public `EmailBuilderCanvas` only — editable and read-only. No metadata, preview, or save chrome. Uses the MUI EmailBuilder surface (inspector + samples).',
      },
    },
  },
} satisfies Meta<typeof EmailBuilderCanvas>;

export default meta;
type Story = StoryObj<typeof meta>;

function EditableCanvas(): JSX.Element {
  const [document, setDocument] = useState<EmailBuilderDocument>(nestedBlocksTemplate.templateJson);
  return <EmailBuilderCanvas document={document} onChange={setDocument} />;
}

export const Editable: Story = {
  render: () => <EditableCanvas />,
};

export const ReadOnly: Story = {
  args: {
    document: nestedBlocksTemplate.templateJson,
    onChange: () => {
      /* read-only */
    },
    readOnly: true,
  },
};
