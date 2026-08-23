/**
 * Template source contracts.
 *
 * These types describe the three Git-backed source files that live in a
 * consumer repository under `content/email-templates/<key>/`:
 *   - template.json  — EmailBuilder.js document (editable source of truth)
 *   - metadata.json  — TemplateSourceMetadata
 *   - preview.json   — TemplatePreviewData
 *
 * They are consumed by post-kit-compiler, post-kit-publisher, and
 * post-kit-editor. They must not be imported by apps/api at runtime —
 * the API works with compiled artifacts only.
 */

/** Current schema version for template source files. */
export const TEMPLATE_SCHEMA_VERSION = '1' as const;

/**
 * Contents of `metadata.json` — describes a single email template.
 *
 * @example
 * {
 *   key: 'marketing.contact-us',
 *   name: 'Contact Us',
 *   subject: 'New message from {{name}}',
 *   description: 'Sent to the support inbox from the public contact form',
 *   variables: ['name', 'email', 'message'],
 *   schemaVersion: '1',
 * }
 */
export interface TemplateSourceMetadata {
  /** Unique template identifier, e.g. `marketing.contact-us`. */
  key: string;
  /** Human-readable display name. */
  name: string;
  /**
   * Email subject line. May contain `{{variable}}` placeholders using the
   * same syntax as the HTML body.
   */
  subject: string;
  /** Optional human-readable description of the template's purpose. */
  description?: string;
  /**
   * Ordered list of variable names required to render this template.
   * Each entry corresponds to a `{{name}}` placeholder in the subject or body.
   */
  variables: string[];
  /** Schema version of this metadata file. Must equal `TEMPLATE_SCHEMA_VERSION`. */
  schemaVersion: typeof TEMPLATE_SCHEMA_VERSION;
}

/**
 * Contents of `preview.json` — representative sample values for every variable
 * declared in `TemplateSourceMetadata.variables`.
 *
 * Used by the compiler for preview rendering, CI validation, and the editor's
 * preview pane. Must not contain real personal data or secrets.
 *
 * @example
 * { name: 'Jane Doe', email: 'jane@example.com', message: 'Hello!' }
 */
export type TemplatePreviewData = Record<string, string>;

/**
 * The compiled manifest embedded in every published template artifact.
 * Written by post-kit-compiler and stored alongside `template.html`.
 */
export interface TemplateManifest {
  /** Template key — matches `TemplateSourceMetadata.key`. */
  key: string;
  /** Schema version of the compiled artifact format. Must equal `TEMPLATE_SCHEMA_VERSION`. */
  schemaVersion: typeof TEMPLATE_SCHEMA_VERSION;
  /** ISO 8601 timestamp of when this artifact was compiled. */
  compiledAt: string;
  /**
   * Git commit SHA of the source tree at compile time.
   * Empty string if not available (e.g. local development builds).
   */
  sourceCommit: string;
  /** Variable names declared in metadata — copied into the manifest for quick access. */
  variables: string[];
  /** SHA-256 hex digest of the compiled HTML. Enables change detection. */
  contentHash: string;
}

/**
 * A fully compiled template artifact, produced by post-kit-compiler and
 * consumed at runtime by apps/api via TemplateStore.
 */
export interface CompiledTemplate {
  /** Rendered HTML with variables left as placeholders for runtime substitution. */
  templateHtml: string;
  /** Original template metadata. */
  metadata: TemplateSourceMetadata;
  /** Compilation provenance and integrity information. */
  manifest: TemplateManifest;
}
