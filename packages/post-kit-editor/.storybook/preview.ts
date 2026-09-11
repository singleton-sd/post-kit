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
    viewport: {
      viewports: {
        desktop: {
          name: 'Desktop',
          styles: { width: '1440px', height: '900px' },
          type: 'desktop',
        },
        narrow: {
          name: 'Narrow',
          styles: { width: '900px', height: '800px' },
          type: 'desktop',
        },
        mobile: {
          name: 'Mobile',
          styles: { width: '390px', height: '844px' },
          type: 'mobile',
        },
      },
      defaultViewport: 'desktop',
    },
  },
};

export default preview;
