import type { Meta, StoryObj } from '@storybook/react';

import {
  EmailTemplateEditor,
  type SerializedTemplateSource,
  type TemplateSourceFiles,
} from '../src';
import { nestedBlocksTemplate, sampleAvailableVariables } from './fixtures';

const meta = {
  title: 'Editor/EmailTemplateEditor',
  component: EmailTemplateEditor,
  parameters: {
    docs: {
      description: {
        story:
          'Full consumer mount via the public `EmailTemplateEditor` export. Save and send-test are mocked in-memory — no network, Git, or filesystem I/O.',
      },
    },
  },
} satisfies Meta<typeof EmailTemplateEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

function mockSave(
  _serialized: SerializedTemplateSource,
  _files: TemplateSourceFiles,
): { ok: true; message: string } {
  void _serialized;
  void _files;
  return { ok: true, message: 'Mock save (no persistence).' };
}

function mockSendTest(
  _serialized: SerializedTemplateSource,
  _files: TemplateSourceFiles,
  recipient: string,
): { ok: true; message: string } {
  void _serialized;
  void _files;
  return { ok: true, message: `Mock send-test to ${recipient} (no network).` };
}

export const FullEditor: Story = {
  args: {
    template: nestedBlocksTemplate,
    availableVariables: sampleAvailableVariables,
    onSave: mockSave,
    onSendTest: mockSendTest,
  },
};

export const Loading: Story = {
  args: {
    template: nestedBlocksTemplate,
    onSave: mockSave,
    loading: true,
  },
};

export const LoadError: Story = {
  args: {
    template: nestedBlocksTemplate,
    onSave: mockSave,
    loadError: 'Synthetic load failure for Storybook (host could not fetch template files).',
  },
};
