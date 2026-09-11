import type { Meta, StoryObj } from '@storybook/react';

import {
  EmailTemplateAdmin,
  type SerializedTemplateSource,
  type TemplateSourceFiles,
} from '../src';
import { nestedBlocksTemplate, sampleAvailableVariables } from './fixtures';

import minimalTemplate from '../src/__fixtures__/minimal/template.json';
import minimalMetadata from '../src/__fixtures__/minimal/metadata.json';
import minimalPreview from '../src/__fixtures__/minimal/preview.json';
import { loadTemplateSource } from '../src';

const minimalTemplateFiles = loadTemplateSource({
  templateJson: minimalTemplate,
  metadata: minimalMetadata,
  previewData: minimalPreview,
});

const meta = {
  title: 'Admin/EmailTemplateAdmin',
  component: EmailTemplateAdmin,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        story:
          'Primary consumer mount: full admin page with template list, MUI EmailBuilder canvas, and PostKit chrome. Save/send-test are mocked — no network.',
      },
    },
  },
} satisfies Meta<typeof EmailTemplateAdmin>;

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

export const FullAdmin: Story = {
  args: {
    templates: [nestedBlocksTemplate, minimalTemplateFiles],
    availableVariables: sampleAvailableVariables,
    onSave: mockSave,
    onSendTest: mockSendTest,
  },
};

export const WithoutSendTest: Story = {
  args: {
    templates: [nestedBlocksTemplate],
    onSave: mockSave,
  },
};
