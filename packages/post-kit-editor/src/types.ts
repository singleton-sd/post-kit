import type { TReaderDocument } from '@usewaypoint/email-builder';
import type { TemplateSourceMetadata, TemplatePreviewData } from '@singleton-sd/post-kit-types';

/**
 * EmailBuilder.js reader document — the editable `template.json` payload.
 *
 * Re-exported from `@usewaypoint/email-builder` so editor and compiler share the
 * same structural type accepted by `renderToStaticMarkup` / `compile()`.
 * Additional top-level keys are allowed so forward-compatible fields survive
 * load/serialize round-trips.
 */
export type EmailBuilderDocument = TReaderDocument & Record<string, unknown>;

/**
 * The in-memory triple of Git-backed template source files the editor works on.
 *
 * Mirrors `content/email-templates/<key>/` in a consumer repository:
 *   - template.json — EmailBuilder.js document
 *   - metadata.json — TemplateSourceMetadata
 *   - preview.json  — TemplatePreviewData
 */
export interface TemplateSourceFiles {
  templateJson: EmailBuilderDocument;
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
