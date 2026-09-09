/**
 * Map a clipboard write result to the catalogue Copy button feedback.
 *
 * `copied` is reserved for successful writes. Failures must prompt the user to
 * finish the copy manually after the fallback selection.
 */
export function copyFeedbackKind(result: { ok: boolean }): 'copied' | 'manual' {
  return result.ok ? 'copied' : 'manual';
}

export function copyButtonLabel(
  feedback: { name: string; kind: 'copied' | 'manual' } | null,
  entryName: string,
): string {
  if (feedback?.name !== entryName) {
    return 'Copy';
  }
  return feedback.kind === 'copied' ? 'Copied' : 'Select to copy';
}
