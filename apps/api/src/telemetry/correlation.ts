/**
 * Correlation ID utilities for per-request tracing.
 *
 * No external UUID library — Node 20 ships crypto.randomUUID() natively.
 */

/** Valid correlation ID: 8–128 alphanumeric / hyphen / underscore characters. */
const VALID_CORRELATION_ID = /^[a-zA-Z0-9_-]{8,128}$/;

/**
 * Generate a new UUID v4 correlation ID.
 */
export function generateCorrelationId(): string {
  return crypto.randomUUID();
}

/**
 * Sanitise a caller-supplied X-Correlation-Id header value.
 *
 * Rules: must be 8–128 alphanumeric/hyphen/underscore characters only.
 * If the value is missing, empty, or fails validation, a fresh ID is generated.
 */
export function resolveCorrelationId(headerValue: string | undefined): string {
  if (headerValue && VALID_CORRELATION_ID.test(headerValue)) {
    return headerValue;
  }
  return generateCorrelationId();
}
