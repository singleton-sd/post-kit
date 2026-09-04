import type { TEditorBlock } from '../editor-core';

type BlockTemplate = {
  label: string;
  block: () => TEditorBlock;
};

export const BLOCK_TEMPLATES: BlockTemplate[] = [
  {
    label: 'Heading',
    block: () => ({
      type: 'Heading',
      data: {
        props: { text: 'Hello friend' },
        style: {
          padding: { top: 16, bottom: 16, left: 24, right: 24 },
        },
      },
    }),
  },
  {
    label: 'Text',
    block: () => ({
      type: 'Text',
      data: {
        props: { text: 'My new text block' },
        style: {
          padding: { top: 16, bottom: 16, left: 24, right: 24 },
          fontWeight: 'normal',
        },
      },
    }),
  },
  {
    label: 'Button',
    block: () => ({
      type: 'Button',
      data: {
        props: {
          text: 'Button',
          url: 'https://example.com',
        },
        style: { padding: { top: 16, bottom: 16, left: 24, right: 24 } },
      },
    }),
  },
  {
    label: 'Image',
    block: () => ({
      type: 'Image',
      data: {
        props: {
          url: 'https://placehold.co/600x400',
          alt: 'Sample image',
          contentAlignment: 'middle',
          linkHref: null,
        },
        style: { padding: { top: 16, bottom: 16, left: 24, right: 24 } },
      },
    }),
  },
  {
    label: 'Divider',
    block: () => ({
      type: 'Divider',
      data: {
        style: { padding: { top: 16, right: 0, bottom: 16, left: 0 } },
        props: {
          lineColor: '#CCCCCC',
        },
      },
    }),
  },
  {
    label: 'Spacer',
    block: () => ({
      type: 'Spacer',
      data: {},
    }),
  },
  {
    label: 'Container',
    block: () => ({
      type: 'Container',
      data: {
        style: { padding: { top: 16, bottom: 16, left: 24, right: 24 } },
      },
    }),
  },
];
