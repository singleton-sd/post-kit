// `tsx` (the test runner's loader) compiles JSX with the classic runtime, so
// React must be in scope even though `tsc` is configured for `react-jsx`.
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { EmailBuilderCanvas } from './canvas/EmailBuilderCanvas';
import { InsertionTargetProvider } from './insertion-target';
import { MetadataPanel } from './metadata/MetadataPanel';
import { PreviewDataEditor } from './preview/PreviewDataEditor';
import { PreviewPane } from './preview/PreviewPane';
import { isWorkingDirty } from './save-send/dirty';
import { SaveSendBar } from './save-send/SaveSendBar';
import {
  buildSavePayload,
  invokeConsumerAction,
  type ActionFeedback,
  type SaveResult,
  type SendTestResult,
  type SerializedTemplateSource,
} from './save-send/types';
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
  /**
   * Persist working files. Receives serialized Git file contents plus the
   * structured working triple. The package never writes to disk or network.
   */
  onSave: (
    serialized: SerializedTemplateSource,
    files: TemplateSourceFiles,
  ) => Promise<SaveResult | void> | SaveResult | void;
  /**
   * Optional test-send hook. When omitted, Send-test chrome is hidden.
   * Must route through the consumer's trusted server — never call PostKit from
   * the browser with a long-lived API key.
   */
  onSendTest?: (
    serialized: SerializedTemplateSource,
    files: TemplateSourceFiles,
    recipient: string,
  ) => Promise<SendTestResult | void> | SendTestResult | void;
  /** Notify the host when dirty state changes (navigation guards). */
  onDirtyChange?: (dirty: boolean) => void;
  /**
   * Called with the rendered preview HTML whenever a preview render succeeds.
   * Optional — consumers can offer “open preview in a new tab” without recompiling.
   */
  onPreviewRendered?: (html: string) => void;
  className?: string;
}

/**
 * Email template editor with metadata panel, variable catalogue, canvas,
 * preview-data editor, rendered preview pane, and Save / Send-test controls.
 *
 * Holds the working `TemplateSourceFiles` in local state, seeded from the
 * `template` prop. Persistence and test sending are consumer-supplied callbacks.
 */
export function EmailTemplateEditor({
  template,
  availableVariables,
  onSave,
  onSendTest,
  onDirtyChange,
  onPreviewRendered,
  className,
}: EmailTemplateEditorProps): JSX.Element {
  const [workingFiles, setWorkingFiles] = useState<TemplateSourceFiles>(template);
  const [seedFiles, setSeedFiles] = useState<TemplateSourceFiles>(template);
  const [saveFeedback, setSaveFeedback] = useState<ActionFeedback>({ status: 'idle' });
  const [sendFeedback, setSendFeedback] = useState<ActionFeedback>({ status: 'idle' });
  const onDirtyChangeRef = useRef(onDirtyChange);
  onDirtyChangeRef.current = onDirtyChange;
  const lastDirtyRef = useRef<boolean | null>(null);
  /** Bumped when `template` content changes; ignores stale in-flight save/send. */
  const templateGenerationRef = useRef(0);
  const seedFilesRef = useRef(seedFiles);
  seedFilesRef.current = seedFiles;

  useEffect(() => {
    // Ignore parent identity churn when content matches the current baseline.
    if (!isWorkingDirty(seedFilesRef.current, template)) {
      return;
    }
    templateGenerationRef.current += 1;
    setSaveFeedback({ status: 'idle' });
    setSendFeedback({ status: 'idle' });
    setWorkingFiles(template);
    setSeedFiles(template);
  }, [template]);

  useEffect(() => {
    const dirty = isWorkingDirty(seedFiles, workingFiles);
    if (lastDirtyRef.current === dirty) {
      return;
    }
    lastDirtyRef.current = dirty;
    onDirtyChangeRef.current?.(dirty);
  }, [seedFiles, workingFiles]);

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

  const busy = saveFeedback.status === 'pending' || sendFeedback.status === 'pending';

  const handleSave = useCallback(() => {
    if (busy) {
      return;
    }
    let payload: ReturnType<typeof buildSavePayload>;
    try {
      payload = buildSavePayload(workingFiles);
    } catch (error) {
      setSaveFeedback({
        status: 'failure',
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    const generation = templateGenerationRef.current;
    setSaveFeedback({ status: 'pending' });
    void (async () => {
      const result = await invokeConsumerAction(() => onSave(payload.serialized, payload.files));
      if (generation !== templateGenerationRef.current) {
        return;
      }
      if (result.ok) {
        setSeedFiles(payload.files);
        setSaveFeedback({ status: 'success', message: result.message });
      } else {
        setSaveFeedback({
          status: 'failure',
          message: result.message ?? 'Save failed.',
        });
      }
    })();
  }, [busy, onSave, workingFiles]);

  const handleSendTest = useCallback(
    (recipient: string) => {
      if (busy || !onSendTest) {
        return;
      }
      let payload: ReturnType<typeof buildSavePayload>;
      try {
        payload = buildSavePayload(workingFiles);
      } catch (error) {
        setSendFeedback({
          status: 'failure',
          message: error instanceof Error ? error.message : String(error),
        });
        return;
      }
      const generation = templateGenerationRef.current;
      setSendFeedback({ status: 'pending' });
      void (async () => {
        const result = await invokeConsumerAction(() =>
          onSendTest(payload.serialized, payload.files, recipient),
        );
        if (generation !== templateGenerationRef.current) {
          return;
        }
        if (result.ok) {
          setSendFeedback({ status: 'success', message: result.message });
        } else {
          setSendFeedback({
            status: 'failure',
            message: result.message ?? 'Send test failed.',
          });
        }
      })();
    },
    [busy, onSendTest, workingFiles],
  );

  const rootClassName = [`${EDITOR_CLASS_PREFIX}root`, className].filter(Boolean).join(' ');

  return (
    <div className={rootClassName} data-testid={`${EDITOR_CLASS_PREFIX}root`}>
      <InsertionTargetProvider>
        <div
          className={`${EDITOR_CLASS_PREFIX}layout`}
          data-testid={`${EDITOR_CLASS_PREFIX}layout`}
        >
          <aside className={`${EDITOR_CLASS_PREFIX}sidebar`}>
            <SaveSendBar
              saveFeedback={saveFeedback}
              sendFeedback={sendFeedback}
              busy={busy}
              showSendTest={typeof onSendTest === 'function'}
              onSave={handleSave}
              onSendTest={handleSendTest}
            />
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
