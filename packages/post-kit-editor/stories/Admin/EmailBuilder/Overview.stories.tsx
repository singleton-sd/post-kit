import type { Meta, StoryObj } from '@storybook/react';

import { EmailTemplateAdmin } from '../../../src';
import {
  demoCatalog,
  emptyTemplate,
  mockSave,
  mockSendTest,
  sampleAvailableVariables,
  welcomeTemplate,
} from '../../fixtures';

const meta = {
  title: 'Admin/Email Builder/Overview',
  component: EmailTemplateAdmin,
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta<typeof EmailTemplateAdmin>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  args: {
    templates: [emptyTemplate],
    availableVariables: sampleAvailableVariables,
    onSave: mockSave,
    onSendTest: mockSendTest,
  },
};

export const ExistingWelcome: Story = {
  name: 'Existing Welcome',
  args: {
    templates: demoCatalog,
    availableVariables: sampleAvailableVariables,
    onSave: mockSave,
    onSendTest: mockSendTest,
  },
};

/** Alias for visual-baseline story id stability (`--existing-welcome` preferred). */
export const FullAdmin: Story = {
  ...ExistingWelcome,
  name: 'Full Admin (visual baseline)',
  args: {
    templates: [welcomeTemplate, emptyTemplate],
    availableVariables: sampleAvailableVariables,
    onSave: mockSave,
    onSendTest: mockSendTest,
  },
};
