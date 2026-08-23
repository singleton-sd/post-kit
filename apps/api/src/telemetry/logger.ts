/**
 * Structured JSON logger for per-request telemetry.
 *
 * Design notes:
 * - No external logging library; emits newline-delimited JSON to the injected
 *   write function (default: console.log, suitable for Azure Functions).
 * - Logger instances are per-request — never use as a singleton.
 * - Never log PII: no recipient addresses, variable values, or tokens.
 */

import type { PostKitErrorCode } from '@singleton-sd/post-kit-types';

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
  errorCode?: PostKitErrorCode | string;
  // NOTE: never log recipient addresses, variable values, or tokens
}

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
    // Build the entry: correlationId always present; omit undefined/missing fields.
    const entry: Record<string, unknown> = { level, msg, correlationId };

    if (fields) {
      for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined && key !== 'correlationId') {
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
