import type { TemplateSourceFiles } from '../types';
import { validateSendTestRecipient } from './recipient';
import {
  buildSavePayload,
  invokeConsumerAction,
  type SaveResult,
  type SendTestResult,
  type SerializedTemplateSource,
} from './types';

export type SavePayload = {
  serialized: SerializedTemplateSource;
  files: TemplateSourceFiles;
};

export type StartSaveResult =
  | { status: 'noop' }
  | { status: 'serialize-error'; message: string }
  | { status: 'ready'; payload: SavePayload };

export type FinishSaveResult =
  | { status: 'stale' }
  | { status: 'success'; files: TemplateSourceFiles; message?: string }
  | { status: 'failure'; message: string };

export type StartSendTestResult =
  | { status: 'noop' }
  | { status: 'recipient-error'; message: string }
  | { status: 'serialize-error'; message: string }
  | { status: 'ready'; payload: SavePayload; recipient: string };

export type FinishSendTestResult =
  | { status: 'stale' }
  | { status: 'success'; message?: string }
  | { status: 'failure'; message: string };

/**
 * Gate + serialize for Save. Pure aside from `buildSavePayload` (deterministic).
 * Does not invoke the consumer callback.
 */
export function startSaveAction(input: {
  busy: boolean;
  validationBlocked: boolean;
  files: TemplateSourceFiles;
}): StartSaveResult {
  if (input.busy || input.validationBlocked) {
    return { status: 'noop' };
  }
  try {
    return { status: 'ready', payload: buildSavePayload(input.files) };
  } catch (error) {
    return {
      status: 'serialize-error',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Invoke consumer `onSave` and apply generation/stale handling.
 */
export async function finishSaveAction(input: {
  payload: SavePayload;
  isGenerationCurrent: () => boolean;
  onSave: (
    serialized: SerializedTemplateSource,
    files: TemplateSourceFiles,
  ) => Promise<SaveResult | void> | SaveResult | void;
}): Promise<FinishSaveResult> {
  const result = await invokeConsumerAction(() =>
    input.onSave(input.payload.serialized, input.payload.files),
  );
  if (!input.isGenerationCurrent()) {
    return { status: 'stale' };
  }
  if (result.ok) {
    return {
      status: 'success',
      files: input.payload.files,
      message: result.message,
    };
  }
  return {
    status: 'failure',
    message: result.message ?? 'Save failed.',
  };
}

/**
 * Gate, validate recipient, and serialize for Send-test.
 */
export function startSendTestAction(input: {
  busy: boolean;
  validationBlocked: boolean;
  /** When false, Send-test is not wired (chrome hidden). */
  sendTestEnabled: boolean;
  files: TemplateSourceFiles;
  recipient: string;
}): StartSendTestResult {
  if (input.busy || input.validationBlocked || !input.sendTestEnabled) {
    return { status: 'noop' };
  }
  const recipientError = validateSendTestRecipient(input.recipient);
  if (recipientError) {
    return { status: 'recipient-error', message: recipientError };
  }
  try {
    return {
      status: 'ready',
      payload: buildSavePayload(input.files),
      recipient: input.recipient.trim(),
    };
  } catch (error) {
    return {
      status: 'serialize-error',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Invoke consumer `onSendTest` and apply generation/stale handling.
 */
export async function finishSendTestAction(input: {
  payload: SavePayload;
  recipient: string;
  isGenerationCurrent: () => boolean;
  onSendTest: (
    serialized: SerializedTemplateSource,
    files: TemplateSourceFiles,
    recipient: string,
  ) => Promise<SendTestResult | void> | SendTestResult | void;
}): Promise<FinishSendTestResult> {
  const result = await invokeConsumerAction(() =>
    input.onSendTest(input.payload.serialized, input.payload.files, input.recipient),
  );
  if (!input.isGenerationCurrent()) {
    return { status: 'stale' };
  }
  if (result.ok) {
    return { status: 'success', message: result.message };
  }
  return {
    status: 'failure',
    message: result.message ?? 'Send test failed.',
  };
}
