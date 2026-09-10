// `tsx` (the test runner's loader) compiles JSX with the classic runtime, so
// React must be in scope even though `tsc` is configured for `react-jsx`.
import React, { useCallback, useState } from 'react';

import { EmailBuilderCanvas } from './canvas/EmailBuilderCanvas';
import { InsertionTargetProvider } from './insertion-target';
import { MetadataPanel } from './metadata/MetadataPanel';
import { PreviewDataEditor } from './preview/PreviewDataEditor';
import { PreviewPane } from './preview/PreviewPane';
import type { EmailBuilderDocument, TemplateSourceFiles, TemplateVariable } from './types';
import type { TemplatePreviewData, TemplateSourceMetadata } from '@singleton-sd/post-kit-types';
import { VariableCatalogue } from './variables/VariableCatalogue';
import {
  withDocument,
  withMetadata,
  withMetadataVariables,
  withPreviewData,
} from './working-files';

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
  /**
   * Called with the rendered preview HTML whenever a preview render succeeds.
   * Optional — consumers can offer “open preview in a new tab” without recompiling.
   */
  onPreviewRendered?: (html: string) => void;
  className?: string;
}

/**
 * Email template editor with metadata panel, variable catalogue, canvas,
 * preview-data editor, and rendered preview pane.
 *
 * Holds the working `TemplateSourceFiles` in local state, seeded from the
 * `template` prop. Canvas edits update `templateJson`; metadata and preview
 * edits merge into the working triple. Persistence is consumer-supplied via
 * `onSave`.
 */
export function EmailTemplateEditor({
  template,
  availableVariables,
  onPreviewRendered,
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

  const handlePreviewDataChange = useCallback((previewData: TemplatePreviewData) => {
    setWorkingFiles((current) => withPreviewData(current, previewData));
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
            <PreviewDataEditor
              declaredVariables={workingFiles.metadata.variables}
              previewData={workingFiles.previewData}
              onChange={handlePreviewDataChange}
            />
          </aside>
          <div className={`${EDITOR_CLASS_PREFIX}main`}>
            <EmailBuilderCanvas
              document={workingFiles.templateJson}
              onChange={handleDocumentChange}
            />
            <PreviewPane files={workingFiles} onPreviewRendered={onPreviewRendered} />
          </div>
        </div>
      </InsertionTargetProvider>
    </div>
  );
}
