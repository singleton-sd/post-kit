/**
 * Mock persistence / send-test helpers for Storybook (no network).
 */
import type {
  SaveResult,
  SendTestResult,
  SerializedTemplateSource,
  TemplateSourceFiles,
} from '../../src';

export function mockSave(
  _serialized: SerializedTemplateSource,
  _files: TemplateSourceFiles,
): SaveResult {
  void _serialized;
  void _files;
  return { ok: true, message: 'Mock save (no persistence).' };
}

export function mockSaveFailure(
  _serialized: SerializedTemplateSource,
  _files: TemplateSourceFiles,
): SaveResult {
  void _serialized;
  void _files;
  return { ok: false, message: 'Synthetic save failure.' };
}

export function mockSendTest(
  _serialized: SerializedTemplateSource,
  _files: TemplateSourceFiles,
  recipient: string,
): SendTestResult {
  void _serialized;
  void _files;
  return { ok: true, message: `Mock send-test to ${recipient} (no network).` };
}

/** Delayed success — useful for Saving state / interaction plays. */
export function delaySave(ms = 800): typeof mockSave {
  return async (_serialized, _files) => {
    void _serialized;
    void _files;
    await new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
    return { ok: true, message: 'Mock save (delayed).' };
  };
}

/** Delayed failure. */
export function delaySaveFailure(ms = 800): typeof mockSaveFailure {
  return async (_serialized, _files) => {
    void _serialized;
    void _files;
    await new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
    return { ok: false, message: 'Synthetic save failure (delayed).' };
  };
}
