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
 * A single variable offered to the editing user in the catalogue UI.
 */
export interface TemplateVariable {
  /** Placeholder name as used in `{{name}}`, e.g. `branding.companyName`. */
  name: string;
  /** Human-readable label shown in the catalogue. */
  label?: string;
  /** Optional explanation of what the value contains. */
  description?: string;
}
