import Handlebars from 'handlebars';
import { renderToStaticMarkup, type TReaderDocument } from '@usewaypoint/email-builder';
import type { TemplateSourceMetadata } from '@singleton-sd/post-kit-types';
import { TEMPLATE_SCHEMA_VERSION } from '@singleton-sd/post-kit-types';
import { CompilerError } from './compiler-error';
import type { TemplateSource } from './template-source';

/**
 * Browser-safe preview / validation surface.
 *
 * This module must not import Node built-ins (`node:crypto`, `node:fs`,
 * `node:path`, …). The editor package imports it via
 * `@singleton-sd/post-kit-compiler/preview`. Node-only APIs (`compile`,
 * `compileFromDirectory`) live in `compiler.ts` and the package root export.
 */

/**
 * Validate that `value` satisfies the TemplateSourceMetadata shape.
 * Returns the typed metadata or throws CompilerError(INVALID_METADATA).
 */
export function assertMetadata(value: unknown): TemplateSourceMetadata {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new CompilerError('INVALID_METADATA', 'metadata must be a JSON object');
  }

  const m = value as Record<string, unknown>;

  const requiredStrings = ['key', 'name', 'subject', 'schemaVersion'] as const;

  for (const field of requiredStrings) {
    if (typeof m[field] !== 'string' || (m[field] as string).trim() === '') {
      throw new CompilerError(
        'INVALID_METADATA',
        `metadata.${field} must be a non-empty string (got ${JSON.stringify(m[field])})`,
      );
    }
  }

  if (m['schemaVersion'] !== TEMPLATE_SCHEMA_VERSION) {
    throw new CompilerError(
      'INVALID_METADATA',
      `metadata.schemaVersion must be "${TEMPLATE_SCHEMA_VERSION}" (got ${JSON.stringify(m['schemaVersion'])})`,
    );
  }

  if (!Array.isArray(m['variables'])) {
    throw new CompilerError('INVALID_METADATA', 'metadata.variables must be an array');
  }

  for (let i = 0; i < (m['variables'] as unknown[]).length; i++) {
    if (typeof (m['variables'] as unknown[])[i] !== 'string') {
      throw new CompilerError('INVALID_METADATA', `metadata.variables[${i}] must be a string`);
    }
  }

  return m as unknown as TemplateSourceMetadata;
}

/**
 * Render an EmailBuilder.js document to email HTML.
 *
 * Uses `@usewaypoint/email-builder` `renderToStaticMarkup`. Handlebars is not
 * the HTML renderer — it only substitutes `{{variable}}` values for preview
 * validation after this step.
 */
export function renderTemplateHtml(templateJson: unknown): string {
  if (!isReaderDocument(templateJson)) {
    throw new Error('templateJson must be an EmailBuilder document object with a root block');
  }

  return renderToStaticMarkup(templateJson, { rootBlockId: 'root' });
}

function isReaderDocument(value: unknown): value is TReaderDocument {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'root' in value;
}

/**
 * Shared validate + EmailBuilder render + Handlebars preview substitution.
 *
 * Used by {@link compile} (publish artifact) and {@link renderPreview} (editor
 * pane). Does not touch the filesystem or `node:crypto`.
 */
export function compileTemplateCore(source: TemplateSource): {
  metadata: TemplateSourceMetadata;
  templateHtml: string;
  previewHtml: string;
} {
  const metadata = assertMetadata(source.metadata);

  for (const variable of metadata.variables) {
    if (!Object.prototype.hasOwnProperty.call(source.previewData, variable)) {
      throw new CompilerError(
        'MISSING_PREVIEW_VARIABLE',
        `Preview data is missing variable: "${variable}"`,
      );
    }
  }

  let templateHtml: string;
  try {
    templateHtml = renderTemplateHtml(source.templateJson);
  } catch (err) {
    throw new CompilerError(
      'RENDER_FAILURE',
      `Failed to render template HTML: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let previewHtml: string;
  try {
    Handlebars.compile(metadata.subject)(source.previewData);
    previewHtml = Handlebars.compile(templateHtml)(source.previewData);
  } catch (err) {
    throw new CompilerError(
      'RENDER_FAILURE',
      `Failed to render subject template: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return { metadata, templateHtml, previewHtml };
}

/**
 * Render a template with preview data substituted (editor / local preview).
 *
 * Uses the same EmailBuilder + Handlebars path as {@link compile}, but returns
 * the Handlebars-substituted HTML instead of the placeholder artifact.
 * Safe for browser bundles — no Node built-ins.
 */
export async function renderPreview(source: TemplateSource): Promise<string> {
  const { previewHtml } = compileTemplateCore(source);
  return previewHtml;
}

/**
 * Validate a {@link TemplateSource} without producing output.
 *
 * Runs metadata and preview-coverage checks but never throws — returns an
 * array of error messages instead.
 */
export function validateSource(
  source: TemplateSource,
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];

  let metadata: TemplateSourceMetadata | undefined;

  try {
    metadata = assertMetadata(source.metadata);
  } catch (err) {
    errors.push(err instanceof CompilerError ? err.message : String(err));
  }

  if (metadata !== undefined) {
    for (const variable of metadata.variables) {
      if (!Object.prototype.hasOwnProperty.call(source.previewData, variable)) {
        errors.push(`Preview data is missing variable: "${variable}"`);
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true };
}
