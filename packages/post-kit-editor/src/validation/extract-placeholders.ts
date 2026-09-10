/**
 * Collect `{{placeholder}}` names from subject and EmailBuilder document text.
 * Capture group matches {@link previewSubject} in metadata/subject-preview.ts.
 */

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;

/** Unique placeholder names found in `text`, in first-seen order. */
export function extractPlaceholdersFromText(text: string): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  PLACEHOLDER_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PLACEHOLDER_RE.exec(text)) !== null) {
    const name = match[1];
    if (!seen.has(name)) {
      seen.add(name);
      ordered.push(name);
    }
  }
  return ordered;
}

/**
 * Placeholders in the EmailBuilder document. Walks string leaves so nested
 * props are covered without a block-type schema.
 */
export function extractPlaceholdersFromDocument(document: unknown): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];

  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      for (const name of extractPlaceholdersFromText(value)) {
        if (!seen.has(name)) {
          seen.add(name);
          ordered.push(name);
        }
      }
      return;
    }
    if (value === null || typeof value !== 'object') {
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }
    for (const child of Object.values(value as Record<string, unknown>)) {
      visit(child);
    }
  };

  visit(document);
  return ordered;
}
