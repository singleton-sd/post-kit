/**
 * Reference React host for `@singleton-sd/post-kit-editor`.
 *
 * - List/load: seed from the filesystem store in Node tests / server wiring;
 *   this component takes a preloaded catalog for the embedding demo.
 * - Save: `onSave` → your API → Git/PR (here: in-memory adapter for the demo).
 * - Send-test: pass `sendTest` only when your BFF is configured; omitting it
 *   hides Send-test chrome (see `postSendTestToBff` + README).
 *
 * Never pass API keys into this module or the editor props.
 */
import { useEffect, useRef, useState } from 'react';
import {
  EmailTemplateEditor,
  type SerializedTemplateSource,
  type TemplateSourceFiles,
  type SendTestResult,
} from '@singleton-sd/post-kit-editor';

import {
  createMemoryPersistence,
  reconcileSelectedKey,
  toOnSave,
  type MemoryPersistence,
} from './src/memory-persistence';

export interface AdminEditorExampleProps {
  /** Catalog of templates the admin may open (from Git / your list API). */
  templates: TemplateSourceFiles[];
  /**
   * Optional Send-test callback. Omit when the trusted BFF / env is not
   * configured so the editor hides Send-test. Use {@link postSendTestToBff}
   * once `POSTKIT_API_*` is available server-side.
   */
  sendTest?: (
    serialized: SerializedTemplateSource,
    files: TemplateSourceFiles,
    recipient: string,
  ) => Promise<SendTestResult | void> | SendTestResult | void;
}

/** Browser helper that POSTs to the consumer Send-test BFF (no secrets). */
export async function postSendTestToBff(
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

export function AdminEditorExample({ templates, sendTest }: AdminEditorExampleProps) {
  if (templates.length === 0) {
    throw new Error('AdminEditorExample requires at least one template.');
  }

  const catalogKeys = templates.map((t) => t.metadata.key);
  const persistenceRef = useRef<MemoryPersistence | null>(null);
  if (persistenceRef.current === null) {
    const seed: Record<string, TemplateSourceFiles> = {};
    for (const t of templates) {
      seed[t.metadata.key] = t;
    }
    persistenceRef.current = createMemoryPersistence(seed);
  } else {
    persistenceRef.current.syncCatalog(templates);
  }
  const persistence = persistenceRef.current;

  const [selectedKey, setSelectedKey] = useState(() => catalogKeys[0]!);

  useEffect(() => {
    setSelectedKey((current) => reconcileSelectedKey(current, catalogKeys));
  }, [catalogKeys.join('\0')]);

  const effectiveKey = reconcileSelectedKey(selectedKey, catalogKeys);
  const template = persistence.load(effectiveKey);
  const availableVariables = template.metadata.variables.map((name) => ({
    name,
    label: name,
  }));

  return (
    <div className="pk-admin-editor-example">
      <label>
        Template{' '}
        <select
          value={effectiveKey}
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
        key={effectiveKey}
        template={template}
        availableVariables={availableVariables}
        onSave={toOnSave(persistence)}
        {...(sendTest !== undefined ? { onSendTest: sendTest } : {})}
      />
    </div>
  );
}
