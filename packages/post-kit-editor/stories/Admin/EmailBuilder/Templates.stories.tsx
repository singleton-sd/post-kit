import type { Meta, StoryObj } from '@storybook/react';

import { EmailTemplateAdmin, EmailTemplateEditor } from '../../../src';
import {
  mockSave,
  mockSendTest,
  otpTemplate,
  passwordResetTemplate,
  receiptTemplate,
  reportTemplate,
  sampleAvailableVariables,
  transactionalTemplate,
  welcomeTemplate,
} from '../../fixtures';

const meta = {
  title: 'Admin/Email Builder/Templates',
  component: EmailTemplateAdmin,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof EmailTemplateAdmin>;

export default meta;
type Story = StoryObj<typeof meta>;

const adminArgs = {
  availableVariables: sampleAvailableVariables,
  onSave: mockSave,
  onSendTest: mockSendTest,
};

export const Welcome: Story = {
  args: {
    ...adminArgs,
    templates: [welcomeTemplate],
  },
};

export const Otp: Story = {
  name: 'OTP',
  args: {
    ...adminArgs,
    templates: [otpTemplate],
  },
};

export const PasswordReset: Story = {
  args: {
    ...adminArgs,
    templates: [passwordResetTemplate],
  },
};

export const Transactional: Story = {
  args: {
    ...adminArgs,
    templates: [transactionalTemplate],
  },
};

export const Receipt: Story = {
  args: {
    ...adminArgs,
    templates: [receiptTemplate],
  },
};

export const Report: Story = {
  args: {
    ...adminArgs,
    templates: [reportTemplate],
  },
};

/** Editor-only mount of Welcome (advanced / chrome without catalog). */
export const WelcomeEditor: Story = {
  name: 'Welcome (Editor)',
  render: () => (
    <EmailTemplateEditor
      template={welcomeTemplate}
      availableVariables={sampleAvailableVariables}
      onSave={mockSave}
      onSendTest={mockSendTest}
    />
  ),
};
