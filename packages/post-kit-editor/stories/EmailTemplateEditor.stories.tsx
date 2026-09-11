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
    layout: 'fullscreen',
    docs: {
      description: {
        story:
          'Single-template surface (advanced). Prefer Admin/EmailTemplateAdmin for the full page. Layout CSS is Storybook-only so the PostKit sidebar sits beside the canvas.',
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

/** Canvas + PostKit chrome with room for the MUI EmailBuilder surface. */
export const FullEditor: Story = {
  args: {
    template: nestedBlocksTemplate,
    availableVariables: sampleAvailableVariables,
    onSave: mockSave,
    onSendTest: mockSendTest,
  },
};

export const Loading: Story = {
  parameters: { layout: 'padded' },
  args: {
    template: nestedBlocksTemplate,
    onSave: mockSave,
    loading: true,
  },
};

export const LoadError: Story = {
  parameters: { layout: 'padded' },
  args: {
    template: nestedBlocksTemplate,
    onSave: mockSave,
    loadError: 'Synthetic load failure for Storybook (host could not fetch template files).',
  },
};
