import type { Meta, StoryObj } from '@storybook/react';

import { EmailTemplateAdmin } from '../../../src';
import {
  mockSave,
  mockSendTest,
  receiptTemplate,
  sampleAvailableVariables,
  welcomeTemplate,
} from '../../fixtures';

const meta = {
  title: 'Admin/Email Builder/Responsive',
  component: EmailTemplateAdmin,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof EmailTemplateAdmin>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Desktop: Story = {
  parameters: {
    viewport: { defaultViewport: 'desktop' },
  },
  args: {
    templates: [welcomeTemplate],
    availableVariables: sampleAvailableVariables,
    onSave: mockSave,
    onSendTest: mockSendTest,
  },
};

export const Mobile: Story = {
  parameters: {
    viewport: { defaultViewport: 'mobile' },
  },
  args: {
    templates: [receiptTemplate],
    availableVariables: sampleAvailableVariables,
    onSave: mockSave,
    onSendTest: mockSendTest,
  },
};
