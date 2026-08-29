/**
 * Structured JSON logger for per-request telemetry.
 *
 * Design notes:
 * - No external logging library; emits newline-delimited JSON to the injected
 *   write function (default: console.log, suitable for Azure Functions).
 * - Logger instances are per-request — never use as a singleton.
 * - Never log PII: no recipient addresses, variable values, or tokens.
 *
 * Recipient privacy: `recipientHash` is a 16-character hex prefix of the
 * SHA-256 digest of the trimmed, lowercased recipient address. The raw address
 * is never logged; the hash is deterministic so duplicate/retry analysis can
 * correlate sends to the same recipient without exposing PII.
 */

import { createHash } from 'node:crypto';
import type { PostKitErrorCode } from '@singleton-sd/post-kit-types';

/**
 * Privacy-safe recipient identifier for structured logs.
 * See module header for the documented approach.
 */
export function hashRecipient(email: string): string {
  const normalized = email.trim().toLowerCase();
  return createHash('sha256').update(normalized, 'utf8').digest('hex').slice(0, 16);
}

/**
 * Structured fields that may appear in a log entry.
 * All fields are optional except correlationId (carried by the logger instance).
 */
export interface LogEntry {
  correlationId: string;
  tenantId?: string;
  environment?: string;
  templateKey?: string;
  outcome?: 'sent' | 'failed' | 'validation_error' | 'auth_error';
  durationMs?: number;
  providerMessageId?: string;
  failureCategory?: string;
  recipientHash?: string;
  errorCode?: PostKitErrorCode | string;
  // NOTE: never log recipient addresses, variable values, or tokens
}

/** The explicit set of optional LogEntry keys (excludes correlationId which is always set). */
const LOG_ENTRY_KEYS: ReadonlyArray<keyof Omit<LogEntry, 'correlationId'>> = [
  'tenantId',
  'environment',
  'templateKey',
  'outcome',
  'durationMs',
  'providerMessageId',
  'failureCategory',
  'recipientHash',
  'errorCode',
];

/** Minimal logger interface exposed to callers. */
export interface Logger {
  info(msg: string, fields?: Partial<LogEntry>): void;
  error(msg: string, fields?: Partial<LogEntry>): void;
}

/**
 * Create a per-request logger bound to a correlation ID.
 *
 * @param correlationId - The correlation ID for this request.
 * @param write         - Optional write function; defaults to console.log.
 *                        Tests inject a capture function here.
 */
export function createLogger(
  correlationId: string,
  write: (line: string) => void = console.log,
): Logger {
  function emit(level: 'info' | 'error', msg: string, fields?: Partial<LogEntry>): void {
    // Build the entry: only emit the known LogEntry contract keys to avoid
    // leaking arbitrary properties. correlationId is always present.
    const entry: Record<string, unknown> = { level, msg, correlationId };

    if (fields) {
      for (const key of LOG_ENTRY_KEYS) {
        const value = fields[key];
        if (value !== undefined) {
          entry[key] = value;
        }
      }
    }

    write(JSON.stringify(entry));
  }

  return {
    info(msg, fields) {
      emit('info', msg, fields);
    },
    error(msg, fields) {
      emit('error', msg, fields);
    },
  };
}
