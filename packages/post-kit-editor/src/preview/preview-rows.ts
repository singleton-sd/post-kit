import type { TemplatePreviewData } from '@singleton-sd/post-kit-types';

/** One editable preview.json row in the preview-data editor. */
export interface PreviewDataRow {
  /** Variable / preview key. */
  key: string;
  /** Current string value (may be empty). */
  value: string;
  /**
   * True when the key is present in `previewData` but not listed in
   * `metadata.variables`.
   */
  extra: boolean;
}

/**
 * Build the ordered key/value rows for the preview-data editor.
 *
 * Declared variables appear first (metadata order), including keys missing from
 * `previewData` (empty value). Duplicate declared names are collapsed to the
 * first occurrence so React keys and label/`htmlFor` targets stay unique.
 * Undeclared extras follow, sorted by key.
 */
export function buildPreviewRows(
  declaredVariables: readonly string[],
  previewData: TemplatePreviewData,
): PreviewDataRow[] {
  const seenDeclared = new Set<string>();
  const rows: PreviewDataRow[] = [];

  for (const key of declaredVariables) {
    if (seenDeclared.has(key)) {
      continue;
    }
    seenDeclared.add(key);
    rows.push({
      key,
      value: Object.prototype.hasOwnProperty.call(previewData, key) ? (previewData[key] ?? '') : '',
      extra: false,
    });
  }

  const extras = Object.keys(previewData)
    .filter((key) => !seenDeclared.has(key))
    .sort((a, b) => a.localeCompare(b));

  for (const key of extras) {
    rows.push({
      key,
      value: previewData[key] ?? '',
      extra: true,
    });
  }

  return rows;
}

/**
 * Apply a value edit for an existing key (declared or extra).
 * Always writes an own property so empty declared rows become present keys.
 */
export function setPreviewValue(
  previewData: TemplatePreviewData,
  key: string,
  value: string,
): TemplatePreviewData {
  return { ...previewData, [key]: value };
}

/**
 * Remove a preview key. Declared variables reappear as empty rows on the next
 * {@link buildPreviewRows} call; extras disappear entirely.
 */
export function removePreviewKey(
  previewData: TemplatePreviewData,
  key: string,
): TemplatePreviewData {
  if (!Object.prototype.hasOwnProperty.call(previewData, key)) {
    return previewData;
  }
  const next = { ...previewData };
  delete next[key];
  return next;
}

/**
 * Add a new preview key. Returns `null` when the key is empty or already present.
 */
export function addPreviewKey(
  previewData: TemplatePreviewData,
  key: string,
  value = '',
): TemplatePreviewData | null {
  const trimmed = key.trim();
  if (!trimmed) {
    return null;
  }
  if (Object.prototype.hasOwnProperty.call(previewData, trimmed)) {
    return null;
  }
  return { ...previewData, [trimmed]: value };
}
