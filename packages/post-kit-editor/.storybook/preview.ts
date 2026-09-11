import type { Preview } from '@storybook/react';

import '../stories/storybook-shell.css';

const preview: Preview = {
  parameters: {
    layout: 'padded',
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: {
      default: 'postkit',
      values: [
        { name: 'postkit', value: '#f2f5f7' },
        { name: 'white', value: '#ffffff' },
      ],
    },
  },
};

export default preview;
