/**
 * Structured JSON logger for per-request telemetry.
 *
 * Design notes:
 * - No external logging library; emits newline-delimited JSON to the injected
 *   write function (default: console.log, suitable for Azure Functions).
 * - Logger instances are per-request — never use as a singleton.
 * - Never log PII: no recipient addresses, variable values, or tokens.
 *
 * Recipient privacy: `recipientHash` is `{keyVersionId}.{digest16}` where
 * `digest16` is a 16-character hex prefix of HMAC-SHA256 over the trimmed,
 * lowercased recipient address, keyed by the Key Vault secret
 * `recipient-hash-hmac-key` (loaded into `RECIPIENT_HASH_HMAC_KEY`).
 * `keyVersionId` is the first 8 hex characters of that secret's Key Vault
 * version so operators can tell digests apart after key rotation. The raw
 * address is never logged. Historical pre-HMAC logs used a bare 16-char
 * SHA-256 prefix; see docs/operations/send-metrics-queries.md.
 */

import { createHash, createHmac } from 'node:crypto';
import type { PostKitErrorCode } from '@singleton-sd/post-kit-types';

/** Env holding the HMAC key material (from Key Vault via App Configuration). */
export const RECIPIENT_HASH_HMAC_KEY_ENV = 'RECIPIENT_HASH_HMAC_KEY';

/** Env holding the Key Vault secret version id used in emitted digests. */
export const RECIPIENT_HASH_HMAC_KEY_VERSION_ENV = 'RECIPIENT_HASH_HMAC_KEY_VERSION';

export type HashRecipientOptions = {
  /** HMAC key material. Defaults to `process.env.RECIPIENT_HASH_HMAC_KEY`. */
  secret?: string | Buffer;
  /**
   * Key Vault secret version (or a local stand-in). Defaults to
   * `process.env.RECIPIENT_HASH_HMAC_KEY_VERSION`, then `local`.
   */
  keyVersion?: string;
};

/**
 * Privacy-safe recipient identifier for structured logs.
 * See module header for the documented approach.
 */
export function hashRecipient(email: string, options: HashRecipientOptions = {}): string {
  const secret = options.secret ?? process.env[RECIPIENT_HASH_HMAC_KEY_ENV];
  if (secret === undefined || secret.length === 0) {
    throw new Error(
      `${RECIPIENT_HASH_HMAC_KEY_ENV} is required for recipientHash (Key Vault secret recipient-hash-hmac-key)`,
    );
  }

  const keyVersion =
    options.keyVersion ?? process.env[RECIPIENT_HASH_HMAC_KEY_VERSION_ENV] ?? 'local';
  const keyVersionId = recipientHashKeyVersionId(keyVersion);
  const normalized = email.trim().toLowerCase();
  const digest = createHmac('sha256', secret).update(normalized, 'utf8').digest('hex').slice(0, 16);
  return `${keyVersionId}.${digest}`;
}

/** First 8 hex chars of a Key Vault version, or a stable hex stand-in. */
export function recipientHashKeyVersionId(keyVersion: string): string {
  const hex = keyVersion.toLowerCase().replace(/[^a-f0-9]/g, '');
  if (hex.length >= 8) {
    return hex.slice(0, 8);
  }
  // Non-hex local ids (e.g. "local") still need an 8-hex prefix for the field shape.
  return createHash('sha256').update(keyVersion, 'utf8').digest('hex').slice(0, 8);
}

/**
 * Current `recipientHash` shape: `{8-hex-keyVersionId}.{16-hex-digest}`.
 * Legacy pre-HMAC values were a bare 16-char hex SHA-256 prefix.
 */
export const RECIPIENT_HASH_PATTERN = /^[a-f0-9]{8}\.[a-f0-9]{16}$/;

/** Historical unsalted SHA-256 prefix still present in older Application Insights rows. */
export const LEGACY_RECIPIENT_HASH_PATTERN = /^[a-f0-9]{16}$/;

export function isValidRecipientHash(value: string): boolean {
  return RECIPIENT_HASH_PATTERN.test(value);
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
  outcome?: 'sent' | 'failed' | 'validation_error' | 'auth_error' | 'success';
  durationMs?: number;
  providerMessageId?: string;
  providerRequestId?: string;
  /** Provider/kind category (e.g. `permanent`, `timeout`, `rate_limit`). */
  failureCategory?: string;
  /** Send-path classification: transient vs permanent (see send-timeout-retry). */
  failureClass?: 'transient' | 'permanent';
  /** Provider attempts used for this invocation (1 without idempotent retry). */
  attempt?: number;
  recipientHash?: string;
  errorCode?: PostKitErrorCode | string;
  /** HTTP verb for the inbound request (e.g. `POST`). Distinct from `mcpMethod`. */
  httpMethod?: string;
  /** MCP JSON-RPC method (e.g. `tools/call`, `tools/list`). */
  mcpMethod?: string;
  /** MCP tool name when method is `tools/call`. */
  mcpTool?: string;
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
  'providerRequestId',
  'failureCategory',
  'failureClass',
  'attempt',
  'recipientHash',
  'errorCode',
  'httpMethod',
  'mcpMethod',
  'mcpTool',
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
        if (value === undefined) {
          continue;
        }
        if (key === 'recipientHash' && typeof value === 'string' && !isValidRecipientHash(value)) {
          continue;
        }
        entry[key] = value;
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
