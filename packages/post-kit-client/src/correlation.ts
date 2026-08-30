/** Valid correlation ID: 8–128 alphanumeric / hyphen / underscore characters. */
const VALID_CORRELATION_ID = /^[a-zA-Z0-9_-]{8,128}$/;

/**
 * Validate a caller-supplied correlation ID before it is sent as `x-correlation-id`.
 *
 * Rules match the API's {@link resolveCorrelationId}: 8–128 chars, alphanumeric,
 * hyphen, and underscore only.
 */
export function isValidCorrelationId(value: string): boolean {
  return VALID_CORRELATION_ID.test(value);
}
