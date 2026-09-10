import type { TemplateSourceFiles } from '../types';

/**
 * Stable JSON serialization: object keys sorted recursively so key order does
 * not create false dirty positives.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    sorted[key] = sortKeys(record[key]);
  }
  return sorted;
}

/**
 * Whether working files differ from the seed `template` prop.
 * Compares stable JSON snapshots so key order does not create false dirtiness.
 */
export function isWorkingDirty(seed: TemplateSourceFiles, working: TemplateSourceFiles): boolean {
  return (
    stableStringify(seed.templateJson) !== stableStringify(working.templateJson) ||
    stableStringify(seed.metadata) !== stableStringify(working.metadata) ||
    stableStringify(seed.previewData) !== stableStringify(working.previewData)
  );
}
