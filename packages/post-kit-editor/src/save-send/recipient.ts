/**
 * Basic recipient checks for send-test — non-empty and a plausible email shape.
 * Not a full RFC validator; the consumer server must still validate.
 */
const BASIC_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateSendTestRecipient(recipient: string): string | null {
  const trimmed = recipient.trim();
  if (!trimmed) {
    return 'Enter a recipient email address.';
  }
  if (!BASIC_EMAIL.test(trimmed)) {
    return 'Enter a valid email address.';
  }
  return null;
}
