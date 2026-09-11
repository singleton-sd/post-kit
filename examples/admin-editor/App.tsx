/**
 * Reference React host for `@singleton-sd/post-kit-editor`.
 *
 * Mounts {@link EmailTemplateAdmin} — the full admin page (list, MUI
 * EmailBuilder canvas, PostKit chrome). This example only supplies the catalog
 * and persistence / send-test callbacks.
 *
 * Never pass API keys into this module or the admin props.
 */
import { useRef } from 'react';
import {
  EmailTemplateAdmin,
  type SerializedTemplateSource,
  type TemplateSourceFiles,
  type SendTestResult,
} from '@singleton-sd/post-kit-editor';

import {
  createMemoryPersistence,
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

  // Prefer in-memory copies (includes successful saves) while keeping prop order.
  const workingCatalog = templates.map((t) =>
    persistence.has(t.metadata.key) ? persistence.load(t.metadata.key) : t,
  );

  return (
    <EmailTemplateAdmin
      templates={workingCatalog}
      onSave={toOnSave(persistence)}
      {...(sendTest !== undefined ? { onSendTest: sendTest } : {})}
    />
  );
}
