/**
 * Private/dev-only: `PreviewDataEditor` and `PreviewPane` are not public
 * package exports. Stories import them from `src/` for isolated exploration.
 */
import type { Meta, StoryObj } from '@storybook/react';
import React, { useState } from 'react';
import type { TemplatePreviewData } from '@singleton-sd/post-kit-types';

import { PreviewDataEditor } from '../src/preview/PreviewDataEditor';
import { PreviewPane } from '../src/preview/PreviewPane';
import type { TemplateSourceFiles } from '../src';
import { nestedBlocksTemplate } from './fixtures';

function PreviewDemo(): JSX.Element {
  const [files, setFiles] = useState<TemplateSourceFiles>(nestedBlocksTemplate);

  const handlePreviewDataChange = (previewData: TemplatePreviewData) => {
    setFiles((current) => ({ ...current, previewData }));
  };

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(240px, 320px) 1fr',
        gap: '1.5rem',
        alignItems: 'start',
      }}
    >
      <PreviewDataEditor
        declaredVariables={files.metadata.variables}
        previewData={files.previewData}
        onChange={handlePreviewDataChange}
      />
      <PreviewPane files={files} debounceMs={150} />
    </div>
  );
}

const meta = {
  title: 'Editor/Preview',
  parameters: {
    docs: {
      description: {
        component:
          'Preview-data editor + sandboxed rendered preview pane (private modules). Uses `@singleton-sd/post-kit-compiler/preview` with synthetic fixtures only.',
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const DataAndPane: Story = {
  render: () => <PreviewDemo />,
};
