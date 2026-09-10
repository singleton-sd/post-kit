/**
 * Minimal React embedding for `@singleton-sd/post-kit-editor`.
 *
 * Persistence is the in-memory adapter under `./src/memory-persistence.ts`.
 * No PostKit credentials, no network, no Send-test chrome.
 */
import {
  EmailTemplateEditor,
  loadTemplateSource,
  type TemplateSourceFiles,
} from '@singleton-sd/post-kit-editor';

import { createMemoryPersistence, toOnSave } from './src/memory-persistence';

import templateJson from './sample/template.json';
import metadata from './sample/metadata.json';
import previewData from './sample/preview.json';

const seed: TemplateSourceFiles = loadTemplateSource({
  templateJson,
  metadata,
  previewData,
});

const persistence = createMemoryPersistence({ [seed.metadata.key]: seed });

export function AdminEditorExample() {
  const template = persistence.load(seed.metadata.key);

  return (
    <EmailTemplateEditor
      template={template}
      availableVariables={[
        {
          name: 'name',
          label: 'Recipient name',
          description: 'Synthetic display name only',
        },
      ]}
      onSave={toOnSave(persistence)}
    />
  );
}
