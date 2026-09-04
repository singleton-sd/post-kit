/**
 * Idempotency-Key header validation for POST /emails/send.
 *
 * Keys are consumer-generated; we allowlist characters so the value is safe
 * to hash into a blob path and reject oversized / empty values before storage.
 */

/** 1–128 chars: alphanumeric, underscore, hyphen, dot, colon, tilde. */
const VALID_IDEMPOTENCY_KEY = /^[A-Za-z0-9._:~-]{1,128}$/;

export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

export type IdempotencyKeyValidation = { ok: true; key: string } | { ok: false; error: string };

/**
 * Validate a raw Idempotency-Key header value.
 *
 * Missing / null / undefined means the caller omitted the header — callers
 * should treat that as "no idempotency" rather than calling this helper.
 * Empty string and whitespace-only values are rejected.
 */
export function validateIdempotencyKey(raw: string): IdempotencyKeyValidation {
  const key = raw.trim();
  if (!key) {
    return { ok: false, error: 'Idempotency-Key header must not be empty.' };
  }
  if (key.length > 128) {
    return {
      ok: false,
      error: 'Idempotency-Key header must be at most 128 characters.',
    };
  }
  if (!VALID_IDEMPOTENCY_KEY.test(key)) {
    return {
      ok: false,
      error: 'Idempotency-Key header contains invalid characters. Use 1–128 of [A-Za-z0-9._:~-].',
    };
  }
  return { ok: true, key };
}
