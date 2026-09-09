export { generateCorrelationId, resolveCorrelationId } from './correlation';
export {
  createLogger,
  hashRecipient,
  isValidRecipientHash,
  LEGACY_RECIPIENT_HASH_PATTERN,
  RECIPIENT_HASH_HMAC_KEY_ENV,
  RECIPIENT_HASH_HMAC_KEY_VERSION_ENV,
  RECIPIENT_HASH_PATTERN,
  recipientHashKeyVersionId,
} from './logger';
export type { HashRecipientOptions, LogEntry, Logger } from './logger';
