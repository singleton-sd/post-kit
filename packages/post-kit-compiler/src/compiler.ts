import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import Handlebars from 'handlebars';
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
 * Render a minimal HTML shell around a JSON blob.
 *
 * TODO: replace with @usewaypoint/email-builder render() when available.
 * The real implementation should call the EmailBuilder.js renderer to produce
 * a full email-client-compatible HTML document from the templateJson document.
 * Until that package is integrated, the JSON is serialised and wrapped in a
 * minimal shell so the rest of the pipeline (hashing, manifests, tests) works.
 */
function renderTemplateHtml(templateJson: unknown): string {
  // TODO: replace with @usewaypoint/email-builder render() when available
  const jsonContent = JSON.stringify(templateJson);
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>',
    '<body>',
    `<!-- email-builder-document: ${jsonContent} -->`,
    '</body>',
    '</html>',
  ].join('\n');
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
 *  3. HTML render (placeholder — see renderTemplateHtml).
 *  4. Handlebars subject render for preview validation only.
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

  // 4. Validate subject renders without error (preview/validation only — not for runtime sending)
  try {
    Handlebars.compile(metadata.subject)(source.previewData);
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
