import type { Meta, StoryObj } from '@storybook/react';

import { EmailBuilderCanvas } from '../../../src';
import {
  createColoursLayoutDocument,
  createColumnsBlockDocument,
  createLongContentDocument,
  createNestedContainersDocument,
  createTypographyLayoutDocument,
} from '../../fixtures';
import { CanvasStory } from './Blocks/_CanvasStory';

const meta = {
  title: 'Admin/Email Builder/Layout',
  component: EmailBuilderCanvas,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof EmailBuilderCanvas>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Typography: Story = {
  render: () => <CanvasStory initial={createTypographyLayoutDocument()} />,
};

export const Colours: Story = {
  name: 'Colours',
  render: () => <CanvasStory initial={createColoursLayoutDocument()} />,
};

export const NestedContainers: Story = {
  render: () => <CanvasStory initial={createNestedContainersDocument()} />,
};

export const ColumnsLayout: Story = {
  render: () => <CanvasStory initial={createColumnsBlockDocument()} />,
};

export const LongContent: Story = {
  render: () => <CanvasStory initial={createLongContentDocument()} />,
};
