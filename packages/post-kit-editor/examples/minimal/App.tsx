/**
 * Minimal consumer integration for `@singleton-sd/post-kit-editor`.
 *
 * Copy into a React host (Vite, Next.js route, etc.). The sample JSON under
 * `./sample/` mirrors `src/__fixtures__/nested-blocks/` — synthetic only.
 *
 * Persistence and test-send are entirely consumer-owned. This file never
 * embeds credentials, endpoints, or customer data.
 */
import {
  EmailTemplateEditor,
  loadTemplateSource,
  type SerializedTemplateSource,
  type TemplateSourceFiles,
} from '@singleton-sd/post-kit-editor';

import templateJson from './sample/template.json';
import metadata from './sample/metadata.json';
import previewData from './sample/preview.json';

const template = loadTemplateSource({ templateJson, metadata, previewData });

export function MinimalEditorExample() {
  return (
    <EmailTemplateEditor
      template={template}
      availableVariables={[
        { name: 'name', label: 'Recipient name', description: 'Synthetic display name' },
      ]}
      onSave={async (serialized: SerializedTemplateSource, files: TemplateSourceFiles) => {
        // Commit serialized.templateJson / metadataJson / previewJson (and/or
        // structured `files`) through your own trusted server — never write
        // from the browser with a long-lived PostKit API key.
        void serialized;
        void files;
      }}
      onSendTest={async (
        serialized: SerializedTemplateSource,
        files: TemplateSourceFiles,
        recipient: string,
      ) => {
        // Browser → your trusted server only. The server uses
        // `@singleton-sd/post-kit-client` with secrets from Key Vault / env.
        void serialized;
        void files;
        void recipient;
      }}
      onValidationChange={(issues) => {
        void issues;
      }}
    />
  );
}
