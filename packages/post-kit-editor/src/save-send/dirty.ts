import type { TemplateSourceFiles } from '../types';

/**
 * Whether working files differ from the seed `template` prop.
 * Compares stable JSON snapshots so key order does not create false dirtiness.
 */
export function isWorkingDirty(seed: TemplateSourceFiles, working: TemplateSourceFiles): boolean {
  return (
    JSON.stringify(seed.templateJson) !== JSON.stringify(working.templateJson) ||
    JSON.stringify(seed.metadata) !== JSON.stringify(working.metadata) ||
    JSON.stringify(seed.previewData) !== JSON.stringify(working.previewData)
  );
}
