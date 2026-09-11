/**
 * Private/dev-only: `MetadataPanel`, `VariableCatalogue`, and
 * `InsertionTargetProvider` are not public package exports. Stories import
 * them from `src/` for isolated visual exploration only.
 */
import type { Meta, StoryObj } from '@storybook/react';
import React, { useState } from 'react';
import type { TemplatePreviewData, TemplateSourceMetadata } from '@singleton-sd/post-kit-types';

import { InsertionTargetProvider } from '../src/insertion-target';
import { MetadataPanel } from '../src/metadata/MetadataPanel';
import { VariableCatalogue } from '../src/variables/VariableCatalogue';
import { nestedBlocksTemplate, sampleAvailableVariables } from './fixtures';

function MetadataAndVariablesDemo(): JSX.Element {
  const [metadata, setMetadata] = useState<TemplateSourceMetadata>(nestedBlocksTemplate.metadata);
  const [previewData] = useState<TemplatePreviewData>(nestedBlocksTemplate.previewData);

  return (
    <InsertionTargetProvider>
      <div className="pk-story-shell">
        <MetadataPanel metadata={metadata} previewData={previewData} onChange={setMetadata} />
        <VariableCatalogue
          availableVariables={sampleAvailableVariables}
          metadataVariables={metadata.variables}
          onMetadataVariablesChange={(variables) =>
            setMetadata((current) => ({ ...current, variables }))
          }
        />
      </div>
    </InsertionTargetProvider>
  );
}

const meta = {
  title: 'Editor/MetadataAndVariables',
  parameters: {
    docs: {
      description: {
        component:
          'Metadata panel + variable catalogue (private modules; not part of the published public API). Focus the subject field to enable catalogue insert.',
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => <MetadataAndVariablesDemo />,
};
