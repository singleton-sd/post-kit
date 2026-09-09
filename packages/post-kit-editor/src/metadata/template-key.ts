/**
 * Template key character rules aligned with post-kit-publisher blob paths:
 * `/^[a-zA-Z0-9._-]+$/`, and not `.` or `..`.
 */

/** Allowed character set for a template key (may be empty while editing). */
const SAFE_TEMPLATE_KEY_CHARS = /^[a-zA-Z0-9._-]*$/;

export const TEMPLATE_KEY_CHARSET_MESSAGE =
  'Template key may only contain letters, numbers, dots, underscores, and hyphens.';

export const TEMPLATE_KEY_RESERVED_MESSAGE = 'Template key cannot be "." or "..".';

/**
 * Returns an inline error message when `value` is not a usable draft key, or
 * `null` when the draft is acceptable for continued editing.
 *
 * Empty string is allowed while the user clears the field; `.` and `..` are
 * rejected because the publisher treats them as unsafe.
 */
export function templateKeyInputError(value: string): string | null {
  if (value === '.' || value === '..') {
    return TEMPLATE_KEY_RESERVED_MESSAGE;
  }
  if (!SAFE_TEMPLATE_KEY_CHARS.test(value)) {
    return TEMPLATE_KEY_CHARSET_MESSAGE;
  }
  return null;
}

/**
 * Whether a proposed key string may be applied to working metadata.
 * Invalid characters and reserved keys (`.` / `..`) are rejected.
 */
export function isAcceptableTemplateKeyInput(value: string): boolean {
  return templateKeyInputError(value) === null;
}
