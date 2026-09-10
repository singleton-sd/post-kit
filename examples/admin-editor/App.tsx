/**
 * Reference React host for `@singleton-sd/post-kit-editor`.
 *
 * - List/load: seed from the filesystem store in Node tests / server wiring;
 *   this component takes a preloaded catalog for the embedding demo.
 * - Save: `onSave` → your API → Git/PR (here: in-memory adapter for the demo).
 * - Send-test: `onSendTest` POSTs to **your** `/api/email-templates/send-test`
 *   BFF which holds `POSTKIT_API_KEY` (see `src/send-test-handler.ts`).
 *
 * Never pass API keys into this module or the editor props.
 */
import { useMemo, useState } from 'react';
import {
  EmailTemplateEditor,
  type SerializedTemplateSource,
  type TemplateSourceFiles,
  type SendTestResult,
} from '@singleton-sd/post-kit-editor';

import { createMemoryPersistence, toOnSave } from './src/memory-persistence';

export interface AdminEditorExampleProps {
  /** Catalog of templates the admin may open (from Git / your list API). */
  templates: TemplateSourceFiles[];
  /**
   * Optional override for Send-test. Default posts to
   * `/api/email-templates/send-test` with `{ templateKey, to, variables }`.
   */
  sendTest?: (
    serialized: SerializedTemplateSource,
    files: TemplateSourceFiles,
    recipient: string,
  ) => Promise<SendTestResult | void> | SendTestResult | void;
}

async function defaultSendTest(
  _serialized: SerializedTemplateSource,
  files: TemplateSourceFiles,
  recipient: string,
): Promise<SendTestResult> {
  const res = await fetch('/api/email-templates/send-test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      templateKey: files.metadata.key,
      to: recipient,
      variables: files.previewData,
    }),
  });
  if (!res.ok) {
    let detail = 'Send-test failed.';
    try {
      const body = (await res.json()) as { error?: string };
      if (typeof body.error === 'string' && body.error.length > 0) {
        detail = body.error;
      }
    } catch {
      // keep generic message
    }
    return { ok: false, message: detail };
  }
  return { ok: true };
}

export function AdminEditorExample({
  templates,
  sendTest = defaultSendTest,
}: AdminEditorExampleProps) {
  if (templates.length === 0) {
    throw new Error('AdminEditorExample requires at least one template.');
  }

  const initialKey = templates[0]!.metadata.key;
  const [selectedKey, setSelectedKey] = useState(initialKey);

  const persistence = useMemo(() => {
    const seed: Record<string, TemplateSourceFiles> = {};
    for (const t of templates) {
      seed[t.metadata.key] = t;
    }
    return createMemoryPersistence(seed);
  }, [templates]);

  const template = persistence.load(selectedKey);
  const availableVariables = template.metadata.variables.map((name) => ({
    name,
    label: name,
  }));

  return (
    <div className="pk-admin-editor-example">
      <label>
        Template{' '}
        <select
          value={selectedKey}
          onChange={(event) => setSelectedKey(event.target.value)}
          aria-label="Select template"
        >
          {templates.map((t) => (
            <option key={t.metadata.key} value={t.metadata.key}>
              {t.metadata.name} ({t.metadata.key})
            </option>
          ))}
        </select>
      </label>
      <EmailTemplateEditor
        key={selectedKey}
        template={template}
        availableVariables={availableVariables}
        onSave={toOnSave(persistence)}
        onSendTest={sendTest}
      />
    </div>
  );
}
