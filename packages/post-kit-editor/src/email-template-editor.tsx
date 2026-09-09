// `tsx` (the test runner's loader) compiles JSX with the classic runtime, so
// React must be in scope even though `tsc` is configured for `react-jsx`.
import React, { useCallback, useState } from 'react';

import { EmailBuilderCanvas } from './canvas/EmailBuilderCanvas';
import { InsertionTargetProvider } from './insertion-target';
import { MetadataPanel } from './metadata/MetadataPanel';
import type { EmailBuilderDocument, TemplateSourceFiles, TemplateVariable } from './types';
import type { TemplateSourceMetadata } from '@singleton-sd/post-kit-types';
import { VariableCatalogue } from './variables/VariableCatalogue';
import { withDocument, withMetadata, withMetadataVariables } from './working-files';

/**
 * Prefix for every CSS class the editor emits.
 *
 * The editor ships plain, stable class names rather than a CSS-in-JS runtime or
 * a component library, so consumers can style it with their own stylesheet.
 */
export const EDITOR_CLASS_PREFIX = 'pk-editor-';

export interface EmailTemplateEditorProps {
  /** Template source files loaded from the consumer repository. */
  template: TemplateSourceFiles;
  /** Variable catalogue shown to the editing user. */
  availableVariables?: TemplateVariable[];
  onSave: (files: TemplateSourceFiles) => Promise<void> | void;
  onSendTest?: (files: TemplateSourceFiles, recipient: string) => Promise<void> | void;
  className?: string;
}

/**
 * Email template editor with metadata panel, variable catalogue, and canvas.
 *
 * Holds the working `TemplateSourceFiles` in local state, seeded from the
 * `template` prop. Canvas edits update `templateJson`; metadata edits merge
 * into `metadata`. Persistence is consumer-supplied via `onSave`.
 */
export function EmailTemplateEditor({
  template,
  availableVariables,
  className,
}: EmailTemplateEditorProps): JSX.Element {
  const [workingFiles, setWorkingFiles] = useState<TemplateSourceFiles>(template);

  const handleDocumentChange = useCallback((document: EmailBuilderDocument) => {
    setWorkingFiles((current) => withDocument(current, document));
  }, []);

  const handleMetadataChange = useCallback((metadata: TemplateSourceMetadata) => {
    setWorkingFiles((current) => withMetadata(current, metadata));
  }, []);

  const handleMetadataVariablesChange = useCallback((variables: string[]) => {
    setWorkingFiles((current) => withMetadataVariables(current, variables));
  }, []);

  const rootClassName = [`${EDITOR_CLASS_PREFIX}root`, className].filter(Boolean).join(' ');

  return (
    <div className={rootClassName} data-testid={`${EDITOR_CLASS_PREFIX}root`}>
      <InsertionTargetProvider>
        <div
          className={`${EDITOR_CLASS_PREFIX}layout`}
          data-testid={`${EDITOR_CLASS_PREFIX}layout`}
        >
          <aside className={`${EDITOR_CLASS_PREFIX}sidebar`}>
            <MetadataPanel
              metadata={workingFiles.metadata}
              previewData={workingFiles.previewData}
              onChange={handleMetadataChange}
            />
            <VariableCatalogue
              availableVariables={availableVariables}
              metadataVariables={workingFiles.metadata.variables}
              onMetadataVariablesChange={handleMetadataVariablesChange}
            />
          </aside>
          <EmailBuilderCanvas
            document={workingFiles.templateJson}
            onChange={handleDocumentChange}
          />
        </div>
      </InsertionTargetProvider>
    </div>
  );
}
