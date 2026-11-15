import type { StorybookConfig } from '@storybook/react-vite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const packagesRoot = join(packageRoot, '..');

/**
 * Package-local Storybook for visual exploration of the editor.
 * Config and stories are outside `files` / `dist` and are not published.
 */
const config: StorybookConfig = {
  stories: ['../stories/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-essentials', '@storybook/addon-interactions'],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  core: {
    disableTelemetry: true,
  },
  async viteFinal(viteConfig) {
    const { mergeConfig } = await import('vite');
    return mergeConfig(viteConfig, {
      resolve: {
        // Prefer TypeScript sources so Vite does not need CJS named-export
        // interop from workspace package `dist/` builds.
        alias: {
          '@singleton-sd/post-kit-editor': join(packageRoot, 'src/index.ts'),
          '@singleton-sd/post-kit-compiler/preview': join(
            packagesRoot,
            'post-kit-compiler/src/preview-entry.ts',
          ),
          '@singleton-sd/post-kit-types': join(packagesRoot, 'post-kit-types/src/index.ts'),
        },
      },
    });
  },
};

export default config;
