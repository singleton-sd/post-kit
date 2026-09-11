import type { Meta, StoryObj } from '@storybook/react';

import { EmailBuilderCanvas } from '../../../../src';
import { createButtonBlockDocument, createConfiguredButtonDocument } from '../../../fixtures';
import { CanvasStory } from './_CanvasStory';

const meta = {
  title: 'Admin/Email Builder/Blocks/Button',
  component: EmailBuilderCanvas,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof EmailBuilderCanvas>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => <CanvasStory initial={createButtonBlockDocument()} />,
};

export const Configured: Story = {
  render: () => <CanvasStory initial={createConfiguredButtonDocument()} />,
};
