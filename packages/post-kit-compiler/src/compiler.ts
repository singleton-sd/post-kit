import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import Handlebars from 'handlebars';
import { renderToStaticMarkup, type TReaderDocument } from '@usewaypoint/email-builder';
import type { CompiledTemplate, TemplateSourceMetadata } from '@singleton-sd/post-kit-types';
import { TEMPLATE_SCHEMA_VERSION } from '@singleton-sd/post-kit-types';
import { CompilerError } from './compiler-error';
import type { TemplateSource } from './template-source';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Validate that `value` satisfies the TemplateSourceMetadata shape.
 * Returns the typed metadata or throws CompilerError(INVALID_METADATA).
 */
function assertMetadata(value: unknown): TemplateSourceMetadata {
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
function renderTemplateHtml(templateJson: unknown): string {
  if (!isReaderDocument(templateJson)) {
    throw new Error('templateJson must be an EmailBuilder document object with a root block');
  }

  return renderToStaticMarkup(templateJson, { rootBlockId: 'root' });
}

function isReaderDocument(value: unknown): value is TReaderDocument {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'root' in value;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compile a {@link TemplateSource} into a {@link CompiledTemplate}.
 *
 * Validation steps (in order):
 *  1. Metadata shape check — all required string fields present and non-empty.
 *  2. Preview-variable coverage — every variable listed in metadata must have
 *     a corresponding key in previewData.
 *  3. HTML render via `@usewaypoint/email-builder`.
 *  4. Handlebars subject and preview-variable render (validation only).
 *  5. SHA-256 content hash of the rendered HTML (compiledAt excluded).
 */
export async function compile(
  source: TemplateSource,
  options?: { sourceCommit?: string },
): Promise<CompiledTemplate> {
  // 1. Validate metadata shape
  const metadata = assertMetadata(source.metadata);

  // 2. Check preview variable coverage
  for (const variable of metadata.variables) {
    if (!Object.prototype.hasOwnProperty.call(source.previewData, variable)) {
      throw new CompilerError(
        'MISSING_PREVIEW_VARIABLE',
        `Preview data is missing variable: "${variable}"`,
      );
    }
  }

  // 3. Render HTML
  let templateHtml: string;
  try {
    templateHtml = renderTemplateHtml(source.templateJson);
  } catch (err) {
    throw new CompilerError(
      'RENDER_FAILURE',
      `Failed to render template HTML: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 4. Validate Handlebars in subject and compiled HTML (preview only — stored
  //    HTML keeps {{variable}} placeholders for runtime send).
  try {
    Handlebars.compile(metadata.subject)(source.previewData);
    Handlebars.compile(templateHtml)(source.previewData);
  } catch (err) {
    throw new CompilerError(
      'RENDER_FAILURE',
      `Failed to render subject template: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 5. Compute content hash — compiledAt is intentionally excluded
  const contentHash = createHash('sha256').update(templateHtml).digest('hex');

  const compiledAt = new Date().toISOString();

  return {
    templateHtml,
    metadata,
    manifest: {
      key: metadata.key,
      schemaVersion: TEMPLATE_SCHEMA_VERSION,
      compiledAt,
      sourceCommit: options?.sourceCommit ?? '',
      variables: metadata.variables,
      contentHash,
    },
  };
}

/**
 * Read `template.json`, `metadata.json`, and `preview.json` from `dir` and
 * delegate to {@link compile}.
 */
export async function compileFromDirectory(
  dir: string,
  options?: { sourceCommit?: string },
): Promise<CompiledTemplate> {
  let templateJson: unknown;
  let metadataRaw: unknown;
  let previewData: unknown;

  // Read and parse template.json
  try {
    const raw = await readFile(join(dir, 'template.json'), 'utf-8');
    templateJson = JSON.parse(raw);
  } catch (err) {
    throw new CompilerError(
      'INVALID_TEMPLATE_JSON',
      `Failed to read/parse template.json in "${dir}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Read and parse metadata.json
  try {
    const raw = await readFile(join(dir, 'metadata.json'), 'utf-8');
    metadataRaw = JSON.parse(raw);
  } catch (err) {
    throw new CompilerError(
      'INVALID_METADATA',
      `Failed to read/parse metadata.json in "${dir}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Read and parse preview.json
  try {
    const raw = await readFile(join(dir, 'preview.json'), 'utf-8');
    previewData = JSON.parse(raw);
  } catch (err) {
    throw new CompilerError(
      'INVALID_METADATA',
      `Failed to read/parse preview.json in "${dir}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return compile(
    {
      templateJson,
      metadata: metadataRaw as TemplateSourceMetadata,
      previewData: previewData as Record<string, string>,
    },
    options,
  );
}

/**
 * Validate a {@link TemplateSource} without producing output.
 *
 * Runs all validation steps from {@link compile} but never throws — returns
 * an array of error messages instead.
 */
export function validateSource(
  source: TemplateSource,
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];

  let metadata: TemplateSourceMetadata | undefined;

  // Validate metadata shape
  try {
    metadata = assertMetadata(source.metadata);
  } catch (err) {
    errors.push(err instanceof CompilerError ? err.message : String(err));
  }

  // Validate preview variable coverage (only if metadata parsed successfully)
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
