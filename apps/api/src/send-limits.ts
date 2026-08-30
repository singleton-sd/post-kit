/**
 * Request size limits for `POST /emails/send`.
 *
 * Defaults (override via SEND_MAX_* env vars / App Configuration):
 *   SEND_MAX_BODY_BYTES            — 256 KiB (262_144)
 *   SEND_MAX_VARIABLES_BYTES       — 128 KiB (131_072) total JSON size of `variables`
 *   SEND_MAX_VARIABLE_VALUE_BYTES  — 32 KiB (32_768) per variable value
 */

export const DEFAULT_SEND_MAX_BODY_BYTES = 262_144;
export const DEFAULT_SEND_MAX_VARIABLES_BYTES = 131_072;
export const DEFAULT_SEND_MAX_VARIABLE_VALUE_BYTES = 32_768;

export interface SendSizeLimits {
  maxBodyBytes: number;
  maxVariablesBytes: number;
  maxVariableValueBytes: number;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

let cachedLimits: SendSizeLimits | undefined;

export function getSendSizeLimits(): SendSizeLimits {
  cachedLimits ??= {
    maxBodyBytes: parsePositiveInt(process.env.SEND_MAX_BODY_BYTES, DEFAULT_SEND_MAX_BODY_BYTES),
    maxVariablesBytes: parsePositiveInt(
      process.env.SEND_MAX_VARIABLES_BYTES,
      DEFAULT_SEND_MAX_VARIABLES_BYTES,
    ),
    maxVariableValueBytes: parsePositiveInt(
      process.env.SEND_MAX_VARIABLE_VALUE_BYTES,
      DEFAULT_SEND_MAX_VARIABLE_VALUE_BYTES,
    ),
  };
  return cachedLimits;
}

export function resetSendSizeLimitsCache(): void {
  cachedLimits = undefined;
}

export function validateRequestBodySize(
  rawBody: string,
  limits: SendSizeLimits = getSendSizeLimits(),
): { ok: true } | { ok: false; error: string } {
  const bytes = utf8ByteLength(rawBody);
  if (bytes > limits.maxBodyBytes) {
    return {
      ok: false,
      error: `Request body exceeds the maximum size of ${limits.maxBodyBytes} bytes.`,
    };
  }
  return { ok: true };
}

export function validateVariablesSize(
  variables: Record<string, string>,
  limits: SendSizeLimits = getSendSizeLimits(),
): { ok: true } | { ok: false; error: string } {
  for (const [key, value] of Object.entries(variables)) {
    const valueBytes = utf8ByteLength(value);
    if (valueBytes > limits.maxVariableValueBytes) {
      return {
        ok: false,
        error: `variables.${key} exceeds the maximum value length of ${limits.maxVariableValueBytes} bytes.`,
      };
    }
  }

  const serialized = JSON.stringify(variables);
  const totalBytes = utf8ByteLength(serialized);
  if (totalBytes > limits.maxVariablesBytes) {
    return {
      ok: false,
      error: `variables exceed the maximum total size of ${limits.maxVariablesBytes} bytes.`,
    };
  }

  return { ok: true };
}
