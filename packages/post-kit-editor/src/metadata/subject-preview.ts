import type { TemplatePreviewData } from '@singleton-sd/post-kit-types';

/**
 * Display-only subject substitution using preview data.
 *
 * Not authoritative for compile/send — unknown placeholders are left intact.
 */
export function previewSubject(subject: string, previewData: TemplatePreviewData): string {
  return subject.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (match, name: string) => {
    if (Object.prototype.hasOwnProperty.call(previewData, name)) {
      return previewData[name] ?? match;
    }
    return match;
  });
}
