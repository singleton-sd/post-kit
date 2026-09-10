import type { TemplateSourceFiles } from '../types';
import { serializeTemplateSource } from '../serialization';

/** Three Git-backed file contents produced by {@link serializeTemplateSource}. */
export type SerializedTemplateSource = ReturnType<typeof serializeTemplateSource>;

export interface SaveResult {
  ok: boolean;
  /** Message shown to the user on failure. */
  message?: string;
}

export interface SendTestResult {
  ok: boolean;
  /** Message shown to the user on failure. */
  message?: string;
}

export type ActionStatus = 'idle' | 'pending' | 'success' | 'failure';

export interface ActionFeedback {
  status: ActionStatus;
  message?: string;
}

/**
 * Invoke a consumer save/send-test callback and normalize settle into
 * {@link SaveResult} / {@link SendTestResult}. Never throws — rejected promises
 * become `{ ok: false, message }`.
 */
export async function invokeConsumerAction(
  run: () => Promise<SaveResult | SendTestResult | void> | SaveResult | SendTestResult | void,
): Promise<SaveResult | SendTestResult> {
  try {
    const result = await run();
    if (result && typeof result === 'object' && 'ok' in result) {
      return result;
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Serialize working files for the save / send-test payload. */
export function buildSavePayload(files: TemplateSourceFiles): {
  serialized: SerializedTemplateSource;
  files: TemplateSourceFiles;
} {
  return {
    serialized: serializeTemplateSource(files),
    files,
  };
}
