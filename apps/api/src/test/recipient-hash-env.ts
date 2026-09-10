/**
 * Side-effect helper for unit tests that exercise send telemetry hashing.
 * Production loads the key from Key Vault via App Configuration; tests inject
 * a fixed non-secret stand-in (never a real Key Vault value).
 */
import {
  RECIPIENT_HASH_HMAC_KEY_ENV,
  RECIPIENT_HASH_HMAC_KEY_VERSION_ENV,
} from '../telemetry/logger';

export function ensureTestRecipientHashEnv(): void {
  process.env[RECIPIENT_HASH_HMAC_KEY_ENV] ??= 'unit-test-recipient-hmac-key';
  process.env[RECIPIENT_HASH_HMAC_KEY_VERSION_ENV] ??= 'abcd1234eeeeffff0000111122223333';
}

ensureTestRecipientHashEnv();
