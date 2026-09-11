import type { Meta, StoryObj } from '@storybook/react';

import { EmailBuilderCanvas } from '../../../../src';
import { createImageBlockDocument } from '../../../fixtures';
import { CanvasStory } from './_CanvasStory';

const meta = {
  title: 'Admin/Email Builder/Blocks/Image',
  component: EmailBuilderCanvas,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof EmailBuilderCanvas>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => <CanvasStory initial={createImageBlockDocument()} />,
};
