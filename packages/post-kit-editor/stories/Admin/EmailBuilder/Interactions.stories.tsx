import type { Meta, StoryObj } from '@storybook/react';
import { expect, userEvent, within } from '@storybook/test';

import { EmailTemplateEditor } from '../../../src';
import {
  createEmptyEmailDocument,
  delaySave,
  delaySaveFailure,
  emptyTemplate,
  sampleAvailableVariables,
} from '../../fixtures';
import { CanvasStory } from './Blocks/_CanvasStory';

const meta = {
  title: 'Admin/Email Builder/Interactions',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj;

/**
 * Samples drawer opens by default. Play loads “Welcome email” from the Samples
 * list (deterministic). Hover-gated add-block menus are intentionally skipped.
 */
export const AddBlock: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Empty canvas → Samples drawer “Welcome email”. Direct add-block controls are hover-only and not exercised here.',
      },
    },
  },
  render: () => <CanvasStory initial={createEmptyEmailDocument()} />,
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    const welcome = await canvas.findByRole('button', { name: /welcome email/i });
    await step('Load Welcome email sample', async () => {
      await userEvent.click(welcome);
    });
    await expect(welcome).toBeInTheDocument();
  },
};

export const SaveSuccess: Story = {
  render: () => (
    <EmailTemplateEditor
      template={emptyTemplate}
      availableVariables={sampleAvailableVariables}
      onSave={delaySave(200)}
    />
  ),
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    const save = await canvas.findByTestId('pk-editor-save');
    await step('Click Save', async () => {
      await userEvent.click(save);
    });
    await step('Assert success feedback', async () => {
      const status = await canvas.findByTestId('pk-editor-save-status');
      await expect(status).toHaveTextContent(/mock save/i);
    });
  },
};

export const SaveFailure: Story = {
  render: () => (
    <EmailTemplateEditor
      template={emptyTemplate}
      availableVariables={sampleAvailableVariables}
      onSave={delaySaveFailure(200)}
    />
  ),
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    const save = await canvas.findByTestId('pk-editor-save');
    await step('Click Save', async () => {
      await userEvent.click(save);
    });
    await step('Assert failure feedback', async () => {
      const status = await canvas.findByTestId('pk-editor-save-status');
      await expect(status).toHaveTextContent(/synthetic save failure/i);
    });
  },
};
