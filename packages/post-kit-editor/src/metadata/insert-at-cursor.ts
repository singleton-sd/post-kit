/**
 * Insert `insertion` into `value` at the given selection range, returning the
 * next value and caret position after the inserted text.
 */
export function insertAtCursor(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  insertion: string,
): { value: string; caret: number } {
  const start = clampIndex(selectionStart, value.length);
  const end = clampIndex(selectionEnd, value.length);
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  const next = value.slice(0, from) + insertion + value.slice(to);
  return { value: next, caret: from + insertion.length };
}

function clampIndex(index: number, length: number): number {
  if (!Number.isFinite(index)) {
    return length;
  }
  return Math.max(0, Math.min(Math.trunc(index), length));
}

/** Format a variable name as a `{{name}}` placeholder. */
export function variablePlaceholder(name: string): string {
  return `{{${name}}}`;
}
