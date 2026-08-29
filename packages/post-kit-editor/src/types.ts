import type { TemplateSourceMetadata, TemplatePreviewData } from '@singleton-sd/post-kit-types';

/**
 * The in-memory triple of Git-backed template source files the editor works on.
 *
 * Mirrors `content/email-templates/<key>/` in a consumer repository:
 *   - template.json — EmailBuilder.js document
 *   - metadata.json — TemplateSourceMetadata
 *   - preview.json  — TemplatePreviewData
 */
export interface TemplateSourceFiles {
  /** EmailBuilder.js document — typed in the canvas issue. */
  templateJson: unknown;
  metadata: TemplateSourceMetadata;
  previewData: TemplatePreviewData;
}

/**
 * A single variable offered to the editing user, with optional guidance shown
 * alongside it in the variable catalogue.
 */
export interface TemplateVariable {
  /** Variable name as it appears in `{{name}}` placeholders. */
  name: string;
  /** Optional human-readable explanation of what the variable holds. */
  description?: string;
  /** Optional sample value used for preview affordances. */
  example?: string;
}
